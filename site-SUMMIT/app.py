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
# (Sem alterações)
app.config['MYSQL_HOST'] = 'localhost'
app.config['MYSQL_USER'] = 'root'
app.config['MYSQL_PASSWORD'] = 'Foda12345'
app.config['MYSQL_DB'] = 'task_flowup'
app.config['MYSQL_CURSORCLASS'] = 'DictCursor'

mysql = MySQL(app)

# --- Funções de Criptografia ---
# (Sem alterações)
def create_salt():
    return os.urandom(16).hex()

def hash_password(password, salt):
    salted_password = password.encode('utf-8') + salt.encode('utf-8')
    return hashlib.sha256(salted_password).hexdigest()

# --- Rotas de Autenticação ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    username, password, role, email = data.get('username'), data.get('password'), data.get('role'), data.get('email')
    # NOVO CAMPO
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
    
    # QUERY ATUALIZADA
    cursor.execute(
        "INSERT INTO users (username, password_hash, salt, role, email, needs_password_reset, job_title) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (username, password_hash, salt, role, email, needs_password_reset, job_title)
    )
    mysql.connection.commit()
    cursor.close()
    return jsonify({'message': 'Usuário registrado com sucesso.'}), 201


@app.route('/api/login', methods=['POST'])
def login():
    # (Sem alterações, mas a query agora busca job_title)
    data = request.json
    username, password = data.get('username'), data.get('password')
    cursor = mysql.connection.cursor()
    # QUERY ATUALIZADA
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
        'jobTitle': user_row['job_title'], # NOVO CAMPO
        'needsPasswordReset': bool(user_row['needs_password_reset'])
    }

    return jsonify({'message': 'Login bem-sucedido.', 'user': user_data}), 200


@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    # (Sem alterações)
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
        cursor.close()
        return jsonify({
            'message': 'Uma nova senha temporária foi gerada com sucesso. Faça login para alterá-la.',
            'tempPassword': temp_password
        })
    
    cursor.close()
    return jsonify({'message': 'Se existir uma conta com este e-mail, as instruções foram processadas.'})


@app.route('/api/user/reset-password', methods=['POST'])
def reset_password():
    # (Sem alterações)
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
    return jsonify({'message': 'Senha atualizada com sucesso.'})


# --- NOVA ROTA PARA MUDAR SENHA (LOGADO) ---
@app.route('/api/user/change-password', methods=['POST'])
def change_password():
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
        
    # Verifica a senha antiga
    if hash_password(old_password, user['salt']) != user['password_hash']:
        cursor.close()
        return jsonify({'error': 'Senha antiga incorreta.'}), 401

    # Atualiza para a nova senha
    new_password_hash = hash_password(new_password, user['salt'])
    cursor.execute(
        "UPDATE users SET password_hash = %s, needs_password_reset = 0 WHERE id = %s",
        (new_password_hash, user_id)
    )
    mysql.connection.commit()
    cursor.close()
    return jsonify({'message': 'Senha atualizada com sucesso.'})


@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user_details(user_id):
    cursor = mysql.connection.cursor()
    # QUERY ATUALIZADA
    cursor.execute("SELECT id, username, email, role, job_title FROM users WHERE id = %s", (user_id,))
    user = cursor.fetchone()
    cursor.close()
    if not user:
        return jsonify({'error': 'Usuário não encontrado.'}), 404
    return jsonify(user)

@app.route('/api/user/<int:user_id>', methods=['PUT'])
def update_user_profile(user_id):
    data = request.json
    new_username = data.get('username')
    new_email = data.get('email')
    # NOVO CAMPO
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

    # QUERY ATUALIZADA
    cursor.execute(
        "UPDATE users SET username = %s, email = %s, job_title = %s WHERE id = %s", 
        (new_username, new_email, new_job_title, user_id)
    )
    mysql.connection.commit()
    
    # QUERY ATUALIZADA
    cursor.execute("SELECT id, username, email, role, job_title FROM users WHERE id = %s", (user_id,))
    updated_user = cursor.fetchone()
    cursor.close()
    
    return jsonify({'message': 'Perfil atualizado com sucesso.', 'user': updated_user})


@app.route('/api/users/employees', methods=['GET'])
def get_employees():
    cursor = mysql.connection.cursor()
    # QUERY ATUALIZADA (para a nova página de equipe)
    cursor.execute("SELECT id, username, email, job_title FROM users WHERE role = 'funcionario' ORDER BY username ASC")
    employees = cursor.fetchall()
    cursor.close()
    return jsonify(employees)


# --- ROTA DE ANÁLISE ---
# (Sem alterações)
@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    cursor = mysql.connection.cursor()
    
    # Contagens gerais
    cursor.execute("SELECT COUNT(*) as total FROM tasks")
    total_tasks = cursor.fetchone()['total']
    
    cursor.execute("SELECT COUNT(*) as total FROM tasks WHERE completed = 1")
    completed_tasks = cursor.fetchone()['total']

    cursor.execute("SELECT COUNT(*) as total FROM tasks WHERE completed = 0")
    pending_tasks = cursor.fetchone()['total']

    # Contagem de tarefas atrasadas (não completas e com prazo no passado)
    cursor.execute("SELECT COUNT(*) as total FROM tasks WHERE completed = 0 AND due_date < CURDATE()")
    overdue_tasks = cursor.fetchone()['total']
    
    # Usuário com mais tarefas atribuídas
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
# (Sem alterações)
@app.route('/api/tasks', methods=['GET', 'POST'])
def tasks():
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
        return jsonify({'message': 'Tarefa criada com sucesso.'}), 201

# --- Demais rotas (manage_task, comments, chat_messages) permanecem iguais ---
# (Sem alterações)
@app.route('/api/tasks/<int:task_id>', methods=['GET', 'PUT', 'DELETE'])
def manage_task(task_id):
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
        if 'completed' in data:
            cursor.execute("UPDATE tasks SET completed = %s WHERE id = %s", (data['completed'], task_id))
        else:
            assigned_to_id = data.get('assigned_to_id') or None
            due_date = data.get('due_date') or None
            cursor.execute(
                "UPDATE tasks SET title = %s, description = %s, priority = %s, due_date = %s, assigned_to_id = %s WHERE id = %s",
                (data.get('title'), data.get('description'), data.get('priority'), due_date, assigned_to_id, task_id)
            )
        mysql.connection.commit()
        cursor.close()
        return jsonify({'message': f'Tarefa {task_id} atualizada.'})

    if request.method == 'DELETE':
        cursor.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        mysql.connection.commit()
        cursor.close()
        return jsonify({'message': f'Tarefa {task_id} deletada.'})


@app.route('/api/tasks/<int:task_id>/comments', methods=['GET', 'POST'])
def comments(task_id):
    # (Sem alterações)
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
        cursor.execute("INSERT INTO task_comments (task_id, user_id, text) VALUES (%s, %s, %s)", (task_id, data.get('user_id'), data.get('text')))
        mysql.connection.commit()
        cursor.close()
        return jsonify({'message': 'Comentário adicionado.'}), 201


@app.route('/api/chat/messages', methods=['GET', 'POST'])
def chat_messages():
    # (Sem alterações)
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


if __name__ == '__main__':
    app.run(debug=True, port=5001)