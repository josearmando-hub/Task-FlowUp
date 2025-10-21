from flask import Flask, request, jsonify
from flask_mysqldb import MySQL
import hashlib
import os
import secrets
from flask_cors import CORS
from datetime import date, datetime

app = Flask(__name__)
CORS(app)

# --- Configurações do banco de dados MySQL ---
app.config['MYSQL_HOST'] = 'localhost'
app.config['MYSQL_USER'] = 'root'
app.config['MYSQL_PASSWORD'] = 'Foda12345'
app.config['MYSQL_DB'] = 'task_flowup'
app.config['MYSQL_CURSORCLASS'] = 'DictCursor'

mysql = MySQL(app)

# --- Funções de Criptografia ---
def create_salt():
    return os.urandom(16).hex()

def hash_password(password, salt):
    salted_password = password.encode('utf-8') + salt.encode('utf-8')
    # --- CORREÇÃO AQUI ---
    return hashlib.sha256(salted_password).hexdigest()
    # ---------------------

# --- NOVA FUNÇÃO AUXILIAR DE LOG ---
def log_activity(user_id, action_text):
    """Registra uma ação no banco de dados activity_log."""
    if not user_id:
        # Não registra se não soubermos quem fez a ação
        return
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            "INSERT INTO activity_log (user_id, action_text) VALUES (%s, %s)",
            (user_id, action_text)
        )
        mysql.connection.commit()
        cursor.close()
    except Exception as e:
        # Em um app real, isso deveria ser logado em um arquivo de erro
        print(f"Erro ao registrar atividade: {e}")


# --- Rotas de Autenticação ---
@app.route('/api/register', methods=['POST'])
def register():
    # (Sem alterações na lógica principal, exceto pelo log)
    data = request.json
    username, password, role, email = data.get('username'), data.get('password'), data.get('role'), data.get('email')
    job_title = data.get('job_title') or 'Funcionário' 
    admin_key_received = data.get('adminKey')
    ADMIN_REGISTRATION_KEY = 'admin-secret-key'
    
    if role == 'admin' and admin_key_received != ADMIN_REGISTRATION_KEY:
        return jsonify({'error': 'Chave de administrador incorreta.'}), 403
    if not all([username, password, role]):
        return jsonify({'error': 'Dados obrigatórios ausentes.'}), 400
    
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT username FROM users WHERE username = %s", (username,))
    if cursor.fetchone():
        cursor.close()
        return jsonify({'error': 'Este nome de usuário já existe.'}), 409
    
    if email:
        cursor.execute("SELECT email FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            cursor.close()
            return jsonify({'error': 'Este e-mail já está em uso.'}), 409
            
    salt = create_salt()
    password_hash = hash_password(password, salt)
    needs_password_reset = (role == 'funcionario')
    
    cursor.execute(
        "INSERT INTO users (username, password_hash, salt, role, email, needs_password_reset, job_title) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (username, password_hash, salt, role, email, needs_password_reset, job_title)
    )
    mysql.connection.commit()
    
    # Log: Pega o ID do usuário recém-criado
    new_user_id = cursor.lastrowid
    log_activity(new_user_id, f"se registrou no sistema como {role}.")
    
    cursor.close()
    return jsonify({'message': 'Usuário registrado com sucesso.'}), 201


@app.route('/api/login', methods=['POST'])
def login():
    # (Adicionado log de atividade)
    data = request.json
    username, password = data.get('username'), data.get('password')
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id, username, password_hash, salt, role, email, needs_password_reset, job_title FROM users WHERE username = %s", (username,))
    user_row = cursor.fetchone()
    cursor.close()

    if not user_row:
        return jsonify({'error': 'Usuário não encontrado.'}), 404

    if hash_password(password, user_row['salt']) != user_row['password_hash']:
        return jsonify({'error': 'Senha incorreta.'}), 401

    user_data = {
        'id': user_row['id'],
        'username': user_row['username'],
        'email': user_row['email'],
        'role': user_row['role'],
        'jobTitle': user_row['job_title'],
        'needsPasswordReset': bool(user_row['needs_password_reset'])
    }
    
    # NOVO LOG:
    log_activity(user_data['id'], f"fez login.")

    return jsonify({'message': 'Login bem-sucedido.', 'user': user_data}), 200


@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    # (Sem alterações, pois o usuário não está logado)
    email = request.json.get('email')
    if not email:
        return jsonify({'error': 'O e-mail é obrigatório.'}), 400

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id, salt FROM users WHERE email = %s", (email,))
    user = cursor.fetchone()

    if user:
        temp_password = secrets.token_hex(8)
        password_hash = hash_password(temp_password, user['salt'])
        cursor.execute(
            "UPDATE users SET password_hash = %s, needs_password_reset = 1 WHERE id = %s",
            (password_hash, user['id'])
        )
        mysql.connection.commit()
        
        # NOVO LOG:
        log_activity(user['id'], "solicitou uma redefinição de senha.")
        
        cursor.close()
        return jsonify({
            'message': 'Uma nova senha temporária foi gerada com sucesso. Faça login para alterá-la.',
            'tempPassword': temp_password
        })
    
    cursor.close()
    return jsonify({'message': 'Se existir uma conta com este e-mail, as instruções foram processadas.'})


@app.route('/api/user/reset-password', methods=['POST'])
def reset_password():
    # (Adicionado log de atividade)
    data = request.json
    user_id, new_password = data.get('userId'), data.get('newPassword')

    if not all([user_id, new_password]):
        return jsonify({'error': 'Dados incompletos.'}), 400
        
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT salt FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()

    if not user:
        cursor.close()
        return jsonify({'error': 'Usuário não encontrado.'}), 404

    password_hash = hash_password(new_password, user['salt'])
    cursor.execute(
        "UPDATE users SET password_hash = %s, needs_password_reset = 0 WHERE id = %s",
        (password_hash, user_id)
    )
    mysql.connection.commit()
    cursor.close()
    
    # NOVO LOG:
    log_activity(user_id, "redefiniu sua senha após login forçado.")
    
    return jsonify({'message': 'Senha atualizada com sucesso.'})


# --- NOVA ROTA PARA MUDAR SENHA (LOGADO) ---
@app.route('/api/user/change-password', methods=['POST'])
def change_password():
    # (Adicionado log de atividade)
    data = request.json
    user_id, old_password, new_password = data.get('userId'), data.get('oldPassword'), data.get('newPassword')

    if not all([user_id, old_password, new_password]):
        return jsonify({'error': 'Dados incompletos.'}), 400
        
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT password_hash, salt FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()

    if not user:
        cursor.close()
        return jsonify({'error': 'Usuário não encontrado.'}), 404
        
    if hash_password(old_password, user['salt']) != user['password_hash']:
        cursor.close()
        return jsonify({'error': 'Senha antiga incorreta.'}), 401

    new_password_hash = hash_password(new_password, user['salt'])
    cursor.execute(
        "UPDATE users SET password_hash = %s, needs_password_reset = 0 WHERE id = %s",
        (new_password_hash, user_id)
    )
    mysql.connection.commit()
    cursor.close()
    
    # NOVO LOG:
    log_activity(user_id, "alterou sua senha através do perfil.")
    
    return jsonify({'message': 'Senha atualizada com sucesso.'})


@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user_details(user_id):
    # (Sem alterações)
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id, username, email, role, job_title FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()
    cursor.close()
    if not user:
        return jsonify({'error': 'Usuário não encontrado.'}), 404
    return jsonify(user)

@app.route('/api/user/<int:user_id>', methods=['PUT'])
def update_user_profile(user_id):
    # (Adicionado log de atividade)
    data = request.json
    new_username = data.get('username')
    new_email = data.get('email')
    new_job_title = data.get('job_title') 

    if not new_username or not new_email:
        return jsonify({'error': 'Nome de usuário e e-mail são obrigatórios.'}), 400

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id FROM users WHERE username = %s AND id != %s", (new_username, user_id))
    if cursor.fetchone():
        cursor.close()
        return jsonify({'error': 'Este nome de usuário já está em uso.'}), 409
    
    cursor.execute("SELECT id FROM users WHERE email = %s AND id != %s", (new_email, user_id))
    if cursor.fetchone():
        cursor.close()
        return jsonify({'error': 'Este e-mail já está em uso.'}), 409

    cursor.execute(
        "UPDATE users SET username = %s, email = %s, job_title = %s WHERE id = %s", 
        (new_username, new_email, new_job_title, user_id)
    )
    mysql.connection.commit()
    
    cursor.execute("SELECT id, username, email, role, job_title FROM users WHERE id = %s", (user_id,))
    updated_user = cursor.fetchone()
    cursor.close()
    
    # NOVO LOG:
    log_activity(user_id, f"atualizou seu perfil (usuário: {new_username}).")
    
    return jsonify({'message': 'Perfil atualizado com sucesso.', 'user': updated_user})


@app.route('/api/users/employees', methods=['GET'])
def get_employees():
    # (Sem alterações)
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id, username, email, job_title FROM users WHERE role = 'funcionario' ORDER BY username ASC")
    employees = cursor.fetchall()
    cursor.close()
    return jsonify(employees)


# --- ROTA DE ANÁLISE ---
# (Sem alterações)
@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    cursor = mysql.connection.cursor()
    
    cursor.execute("SELECT COUNT(*) as total FROM tasks")
    total_tasks = cursor.fetchone()['total']
    
    cursor.execute("SELECT COUNT(*) as total FROM tasks WHERE completed = 1")
    completed_tasks = cursor.fetchone()['total']

    cursor.execute("SELECT COUNT(*) as total FROM tasks WHERE completed = 0")
    pending_tasks = cursor.fetchone()['total']

    cursor.execute("SELECT COUNT(*) as total FROM tasks WHERE completed = 0 AND due_date < CURDATE()")
    overdue_tasks = cursor.fetchone()['total']
    
    query = """
        SELECT u.username, COUNT(t.id) as task_count
        FROM tasks t
        JOIN users u ON t.assigned_to_id = u.id
        GROUP BY u.username
        ORDER BY task_count DESC
        LIMIT 1
    """
    cursor.execute(query)
    top_user = cursor.fetchone()
    
    cursor.close()

    analytics_data = {
        "totalTasks": total_tasks,
        "completedTasks": completed_tasks,
        "pendingTasks": pending_tasks,
        "overdueTasks": overdue_tasks,
        "topUser": top_user if top_user else {"username": "N/A", "task_count": 0}
    }
    return jsonify(analytics_data)


# --- Rotas de Tarefas ---
@app.route('/api/tasks', methods=['GET', 'POST'])
def tasks():
    # (Adicionado log de atividade no POST)
    cursor = mysql.connection.cursor()
    if request.method == 'GET':
        query = """
            SELECT t.*, u_creator.username AS creator_name, u_assignee.username AS assignee_name, COUNT(tc.id) AS comment_count
            FROM tasks t
            LEFT JOIN users u_creator ON t.creator_id = u_creator.id
            LEFT JOIN users u_assignee ON t.assigned_to_id = u_assignee.id
            LEFT JOIN task_comments tc ON t.id = tc.task_id
            GROUP BY t.id ORDER BY t.completed ASC, t.priority ASC, t.due_date ASC
        """
        cursor.execute(query)
        tasks_list = cursor.fetchall()
        cursor.close()
        for task in tasks_list:
            for key, value in task.items():
                if isinstance(value, (datetime, date)): task[key] = value.isoformat()
        return jsonify(tasks_list)
    
    if request.method == 'POST':
        data = request.json
        creator_id, assigned_to_id = data.get('creator_id'), data.get('assigned_to_id') or None
        due_date = data.get('due_date') or None
        
        cursor.execute(
            "INSERT INTO tasks (title, description, priority, due_date, creator_id, assigned_to_id) VALUES (%s, %s, %s, %s, %s, %s)", 
            (data.get('title'), data.get('description'), data.get('priority'), due_date, creator_id, assigned_to_id)
        )
        mysql.connection.commit()
        cursor.close()
        
        # NOVO LOG:
        log_activity(creator_id, f"criou a tarefa: '{data.get('title')}'")
        
        return jsonify({'message': 'Tarefa criada com sucesso.'}), 201


@app.route('/api/tasks/<int:task_id>', methods=['GET', 'PUT', 'DELETE'])
def manage_task(task_id):
    # (Adicionado log de atividade no PUT e DELETE)
    cursor = mysql.connection.cursor()
    if request.method == 'GET':
        cursor.execute("SELECT * FROM tasks WHERE id = %s", (task_id,))
        task = cursor.fetchone()
        cursor.close()
        if task:
            for key, value in task.items():
                if isinstance(value, (datetime, date)): task[key] = value.isoformat()
            return jsonify(task)
        return jsonify({'error': 'Tarefa não encontrada.'}), 404

    if request.method == 'PUT':
        data = request.json
        # ATUALIZADO: Precisamos saber QUEM está fazendo a ação
        acting_user_id = data.get('acting_user_id')
        
        if 'completed' in data:
            # Lógica de concluir/reabrir
            cursor.execute("UPDATE tasks SET completed = %s WHERE id = %s", (data['completed'], task_id))
            action_text = "concluiu" if data['completed'] else "reabriu"
            log_activity(acting_user_id, f"{action_text} a tarefa ID {task_id}.")
        else:
            # Lógica de edição
            assigned_to_id = data.get('assigned_to_id') or None
            due_date = data.get('due_date') or None
            cursor.execute(
                "UPDATE tasks SET title = %s, description = %s, priority = %s, due_date = %s, assigned_to_id = %s WHERE id = %s",
                (data.get('title'), data.get('description'), data.get('priority'), due_date, assigned_to_id, task_id)
            )
            log_activity(acting_user_id, f"editou a tarefa ID {task_id} (novo título: '{data.get('title')}')")
            
        mysql.connection.commit()
        cursor.close()
        return jsonify({'message': f'Tarefa {task_id} atualizada.'})

    if request.method == 'DELETE':
        # ATUALIZADO: Precisamos saber QUEM está fazendo a ação
        # Tenta pegar o JSON, se falhar (sem corpo), usa um dict vazio
        data = request.json if request.is_json else {}
        acting_user_id = data.get('acting_user_id')
        
        cursor.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        mysql.connection.commit()
        cursor.close()
        
        # NOVO LOG:
        log_activity(acting_user_id, f"excluiu a tarefa ID {task_id}.")
        
        return jsonify({'message': f'Tarefa {task_id} deletada.'})


@app.route('/api/tasks/<int:task_id>/comments', methods=['GET', 'POST'])
def comments(task_id):
    # (Adicionado log de atividade no POST)
    cursor = mysql.connection.cursor()
    if request.method == 'GET':
        cursor.execute("SELECT tc.*, u.username FROM task_comments tc JOIN users u ON tc.user_id = u.id WHERE tc.task_id = %s ORDER BY tc.timestamp ASC", (task_id,))
        comments_list = cursor.fetchall()
        cursor.close()
        for comment in comments_list:
            if isinstance(comment.get('timestamp'), datetime): comment['timestamp'] = comment['timestamp'].isoformat()
        return jsonify(comments_list)
    
    if request.method == 'POST':
        data = request.json
        user_id = data.get('user_id')
        text = data.get('text')
        cursor.execute("INSERT INTO task_comments (task_id, user_id, text) VALUES (%s, %s, %s)", (task_id, user_id, text))
        mysql.connection.commit()
        cursor.close()
        
        # NOVO LOG:
        log_activity(user_id, f"comentou na tarefa ID {task_id}: '{text[:30]}...'")
        
        return jsonify({'message': 'Comentário adicionado.'}), 201


@app.route('/api/chat/messages', methods=['GET', 'POST'])
def chat_messages():
    # (Sem alterações, log de chat não foi solicitado)
    cursor = mysql.connection.cursor()
    if request.method == 'GET':
        cursor.execute("SELECT cm.*, u.username, u.role FROM chat_messages cm JOIN users u ON cm.user_id = u.id ORDER BY cm.timestamp ASC")
        messages = cursor.fetchall()
        cursor.close()
        for msg in messages:
            if isinstance(msg.get('timestamp'), datetime): msg['timestamp'] = msg['timestamp'].isoformat()
        return jsonify(messages)
    
    if request.method == 'POST':
        data = request.json
        cursor.execute("INSERT INTO chat_messages (user_id, text) VALUES (%s, %s)", (data.get('user_id'), data.get('text')))
        mysql.connection.commit()
        cursor.close()
        return jsonify({'message': 'Mensagem enviada.'}), 201


# --- NOVA ROTA PARA LOG DE ATIVIDADES ---
@app.route('/api/activity-log', methods=['GET'])
def get_activity_log():
    """Retorna as últimas 50 atividades do sistema."""
    cursor = mysql.connection.cursor()
    query = """
        SELECT a.id, a.action_text, a.timestamp, u.username
        FROM activity_log a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.timestamp DESC
        LIMIT 50
    """
    cursor.execute(query)
    logs = cursor.fetchall()
    cursor.close()
    
    # Converte datetime para string ISO
    for log_entry in logs:
        if isinstance(log_entry.get('timestamp'), datetime):
            log_entry['timestamp'] = log_entry['timestamp'].isoformat()
        if not log_entry['username']:
            log_entry['username'] = "[Usuário Deletado]"
            
    return jsonify(logs)


if __name__ == '__main__':
    app.run(debug=True, port=5001)
