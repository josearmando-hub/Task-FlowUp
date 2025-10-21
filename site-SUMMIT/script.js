document.addEventListener('DOMContentLoaded', () => {
    // --- VARIÁVEIS GLOBAIS ---
    const API_URL = 'http://127.0.0.1:5001/api';
    let currentUser = null;
    let allTasks = [];
    let currentFilter = 'all';
    let editTaskModal, commentsModal, confirmationModal, forceResetModal;

    // --- SELETORES DO DOM ---
    const authContainer = document.querySelector('.auth-container');
    const appContainer = document.querySelector('.app-container');
    const mainContent = document.getElementById('main-content');

    // --- AUTENTICAÇÃO / FORM SWITCH ---
    const showSection = (sectionToShow) => {
        [document.getElementById('login-section'), document.getElementById('registration-section'), document.getElementById('forgot-password-section')].forEach(s => s.style.display = 'none');
        sectionToShow.style.display = 'block';
    };
    document.getElementById('show-register').addEventListener('click', (e) => { e.preventDefault(); showSection(document.getElementById('registration-section')); });
    document.getElementById('show-login').addEventListener('click', (e) => { e.preventDefault(); showSection(document.getElementById('login-section')); });
    document.getElementById('show-forgot-password').addEventListener('click', (e) => { e.preventDefault(); showSection(document.getElementById('forgot-password-section')); });
    document.getElementById('show-login-from-forgot').addEventListener('click', (e) => { e.preventDefault(); showSection(document.getElementById('login-section')); });

    // Registration (sem alterações)
    try {
        document.getElementById('register-form').elements.role.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const isAdmin = e.target.value === 'admin';
                document.getElementById('admin-fields').style.display = isAdmin ? 'block' : 'none';
                document.getElementById('employee-fields').style.display = isAdmin ? 'none' : 'block';
                document.getElementById('admin-key').required = isAdmin;
                document.getElementById('register-email').required = !isAdmin;
            });
        });
    } catch(e) { /* form might differ per deployment; ignore safely */ }

    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('register-error');
        err.textContent = '';
        const fd = {
            username: e.target.elements['register-username'].value.trim(),
            password: e.target.elements['register-password'].value,
            role: e.target.elements.role.value,
            email: document.getElementById('register-email').value.trim(),
            job_title: document.getElementById('register-job-title').value.trim(),
            adminKey: document.getElementById('admin-key').value
        };
        try {
            const res = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fd)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao registrar');
            alert('Usuário registrado com sucesso!');
            showSection(document.getElementById('login-section'));
            e.target.reset();
        } catch (error) {
            err.textContent = error.message;
        }
    });

    // Login (sem alterações)
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('login-error');
        err.textContent = '';
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: e.target.elements.username.value, password: e.target.elements.password.value })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao logar');
            if (data.user && data.user.needsPasswordReset) {
                currentUser = data.user;
                forceResetModal = new bootstrap.Modal(document.getElementById('forcePasswordResetModal'));
                forceResetModal.show();
            } else {
                startSession(data.user);
            }
        } catch (error) {
            err.textContent = error.message;
        }
    });

    // Forgot password (sem alterações)
    document.getElementById('forgot-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fb = document.getElementById('forgot-feedback');
        fb.textContent = '';
        fb.classList.remove('text-success');
        try {
            const res = await fetch(`${API_URL}/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: e.target.elements['forgot-email'].value })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao recuperar senha');
            if (data.tempPassword) {
                fb.innerHTML = `Senha temporária: <strong class="user-select-all">${data.tempPassword}</strong><br>Use-a para fazer login.`;
                fb.classList.add('text-success');
            } else {
                fb.textContent = data.message;
            }
        } catch (error) {
            fb.textContent = error.message;
        }
    });

    // Force reset form inside modal (sem alterações)
    try {
        document.getElementById('force-reset-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = document.getElementById('force-reset-error');
            const newPass = document.getElementById('reset-new-password').value;
            const confPass = document.getElementById('reset-confirm-password').value;
            err.textContent = '';
            if (newPass.length < 4) { err.textContent = 'A senha deve ter pelo menos 4 caracteres.'; return; }
            if (newPass !== confPass) { err.textContent = 'As senhas não coincidem.'; return; }
            try {
                const res = await fetch(`${API_URL}/user/reset-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUser.id, newPassword: newPass })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Erro ao resetar senha');
                alert('Senha atualizada com sucesso!');
                forceResetModal.hide();
                startSession(currentUser);
            } catch (error) {
                err.textContent = error.message;
            }
        });
    } catch(e) { /* ok if modal not present */ }

    // --- SESSÃO ---
    function startSession(user) {
        currentUser = user;
        authContainer.style.display = 'none';
        appContainer.style.display = 'flex';
        document.getElementById('chat-container').style.display = 'block';
        document.getElementById('header-username').textContent = currentUser.username;
        
        const isAdmin = currentUser.role === 'admin';
        document.getElementById('nav-activity-log').style.display = isAdmin ? 'list-item' : 'none';
        
        setupEventListeners();
        renderView('dashboard');
    }
    
    function logout() {
        currentUser = null; allTasks = [];
        appContainer.style.display = 'none';
        mainContent.innerHTML = '';
        document.getElementById('chat-container').style.display = 'none';
        authContainer.style.display = 'flex';
        showSection(document.getElementById('login-section'));
        document.getElementById('login-form').reset();
    }

    // --- EVENT LISTENERS GERAIS ---
    function setupEventListeners() {
        // A lógica do botão de toggle é universal e não depende do tipo de usuário.
        // Esta função garante que o evento seja adicionado assim que a sessão é iniciada.
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            document.body.classList.toggle('sidebar-collapsed');
        });

        document.getElementById('nav-logout').addEventListener('click', logout);
        
        document.getElementById('header-user-info').addEventListener('click', () => {
            renderView('profile');
        });

        document.querySelectorAll('#sidebar .components li').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.getAttribute('data-view');
                if (view) renderView(view);
            });
        });
    }

    // --- RENDERIZAÇÃO DE VIEWS ---
    function renderView(viewName) {
        document.querySelector('#sidebar .components li.active')?.classList.remove('active');
        document.querySelector(`#sidebar .components li[data-view="${viewName}"]`)?.classList.add('active');
        document.getElementById('header-search-container').style.display = 'none';

        if (viewName === 'dashboard') renderDashboardView();
        else if (viewName === 'analytics') renderAnalyticsView();
        else if (viewName === 'profile') renderProfileView();
        else if (viewName === 'team') renderTeamView();
        else if (viewName === 'log') renderActivityLogView();
    }

    // --- PROFILE VIEW ---
    async function renderProfileView() {
        mainContent.innerHTML = `
            <div class="content-header"><h2>Meu Perfil</h2></div>
            <div class="row">
                <div class="col-lg-6">
                    <div class="card"><div class="card-header"><h5 class="mb-0">Detalhes do Perfil</h5></div>
                    <div class="card-body">
                        <form id="profile-form">
                            <div class="mb-3">
                                <label for="profile-username" class="form-label">Nome de Usuário</label>
                                <input type="text" class="form-control" id="profile-username" required>
                            </div>
                            <div class="mb-3">
                                <label for="profile-email" class="form-label">E-mail</label>
                                <input type="email" class="form-control" id="profile-email" required>
                            </div>
                            <div class="mb-3">
                                <label for="profile-job-title" class="form-label">Cargo</label>
                                <input type="text" class="form-control" id="profile-job-title" placeholder="Ex: Desenvolvedor Jr.">
                            </div>
                            <div id="profile-error" class="error-message"></div>
                            <div id="profile-success" class="text-success mb-2"></div>
                            <button type="submit" class="btn btn-primary">Salvar Alterações</button>
                        </form>
                    </div></div>
                </div>
                <div class="col-lg-6">
                    <div class="card"><div class="card-header"><h5 class="mb-0">Alterar Senha</h5></div>
                    <div class="card-body">
                        <form id="change-password-form">
                            <div class="mb-3">
                                <label for="old-password" class="form-label">Senha Antiga</label>
                                <input type="password" class="form-control" id="old-password" required>
                            </div>
                            <div class="mb-3">
                                <label for="new-password" class="form-label">Nova Senha</label>
                                <input type="password" class="form-control" id="new-password" required>
                            </div>
                            <div class="mb-3">
                                <label for="confirm-password" class="form-label">Confirmar Nova Senha</label>
                                <input type="password" class="form-control" id="confirm-password" required>
                            </div>
                            <div id="password-error" class="error-message"></div>
                            <div id="password-success" class="text-success mb-2"></div>
                            <button type="submit" class="btn btn-primary">Alterar Senha</button>
                        </form>
                    </div></div>
                </div>
            </div>`;
        try {
            const response = await fetch(`${API_URL}/user/${currentUser.id}`);
            if (!response.ok) throw new Error('Não foi possível carregar os dados do perfil.');
            const userData = await response.json();
            document.getElementById('profile-username').value = userData.username;
            document.getElementById('profile-email').value = userData.email;
            document.getElementById('profile-job-title').value = userData.job_title || '';
        } catch(error) {
            document.getElementById('profile-error').textContent = error.message;
        }

        document.getElementById('profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const errorEl = document.getElementById('profile-error');
            const successEl = document.getElementById('profile-success');
            errorEl.textContent = '';
            successEl.textContent = '';
            const updatedData = {
                username: document.getElementById('profile-username').value.trim(),
                email: document.getElementById('profile-email').value.trim(),
                job_title: document.getElementById('profile-job-title').value.trim()
            };
            try {
                const response = await fetch(`${API_URL}/user/${currentUser.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Erro ao atualizar perfil');
                currentUser.username = data.user.username;
                currentUser.email = data.user.email;
                currentUser.jobTitle = data.user.job_title;
                document.getElementById('header-username').textContent = currentUser.username;
                successEl.textContent = 'Perfil atualizado com sucesso!';
            } catch (error) {
                errorEl.textContent = error.message;
            }
        });

        document.getElementById('change-password-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const errorEl = document.getElementById('password-error');
            const successEl = document.getElementById('password-success');
            errorEl.textContent = '';
            successEl.textContent = '';
            const oldPassword = document.getElementById('old-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            if (newPassword !== confirmPassword) {
                errorEl.textContent = 'As novas senhas não coincidem.';
                return;
            }
            try {
                const response = await fetch(`${API_URL}/user/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUser.id, oldPassword, newPassword })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Erro ao alterar senha');
                successEl.textContent = data.message;
                e.target.reset();
            } catch (error) {
                errorEl.textContent = error.message;
            }
        });
    }

    // --- DASHBOARD (TAREFAS) ---
    async function renderDashboardView() {
        const searchContainer = document.getElementById('header-search-container');
        searchContainer.style.display = 'block';
        searchContainer.innerHTML = `<input type="search" id="task-search-input" class="form-control" placeholder="🔍 Buscar tarefas...">`;
        document.getElementById('task-search-input').addEventListener('input', renderTasks);

        mainContent.innerHTML = `
            <div class="content-header">
                <h2>Dashboard de Tarefas</h2>
                <div class="task-filters btn-group" role="group">
                    <button type="button" class="btn btn-outline-primary active" data-filter="all">Todas</button>
                    <button type="button" class="btn btn-outline-primary" data-filter="mine">Minhas Tarefas</button>
                    <button type="button" class="btn btn-outline-primary" data-filter="overdue">Atrasadas</button>
                </div>
            </div>
            <div id="add-task-card" class="card my-4" style="display: ${currentUser.role === 'admin' ? 'block' : 'none'}">
                <div class="card-header bg-white py-3"><h5 class="mb-0 fw-bold">Adicionar Nova Tarefa</h5></div>
                <div class="card-body p-4"><form id="task-form"></form></div>
            </div>
            <div id="task-list" class="row gy-4"></div>`;

        mainContent.querySelector('.task-filters').addEventListener('click', handleFilterClick);
        const taskForm = mainContent.querySelector('#task-form');
        if (taskForm) {
            taskForm.innerHTML = `<div class="row g-3"><div class="col-md-6"><label class="form-label">Título</label><input type="text" id="task-title" class="form-control" required></div>
            <div class="col-md-3"><label class="form-label">Prioridade</label><select id="task-priority" class="form-select"><option value="3">Baixa</option><option value="2" selected>Média</option><option value="1">Alta</option></select></div>
            <div class="col-md-3"><label class="form-label">Prazo</label><input type="date" id="task-due-date" class="form-control"></div>
            <div class="col-12"><label class="form-label">Descrição</label><textarea id="task-description" class="form-control" rows="3" required></textarea></div>
            <div class="col-12" style="display: ${currentUser.role === 'admin' ? 'block' : 'none'}"><label class="form-label">Atribuir para:</label><select id="assign-to" class="form-select"><option value="">Ninguém</option></select></div>
            <div class="col-12 text-end"><button type="submit" class="btn btn-success fw-semibold px-4">Salvar Tarefa</button></div></div>`;
            if (currentUser.role === 'admin') await populateAssigneeDropdown(taskForm.querySelector('#assign-to'));
            taskForm.addEventListener('submit', handleAddTask);
        }

        mainContent.querySelector('#task-list').addEventListener('click', handleTaskListClick);
        initializeModalsAndChat();
        fetchAndRenderTasks();
    }

    // --- ANALYTICS VIEW ---
    async function renderAnalyticsView() {
        mainContent.innerHTML = `
            <div class="content-header"><h2>Análise de Desempenho</h2></div>
            <div id="analytics-grid" class="analytics-grid">
                <div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>
            </div>`;
        try {
            const response = await fetch(`${API_URL}/analytics`);
            if (!response.ok) throw new Error('Não foi possível carregar os dados de análise.');
            const data = await response.json();
            document.getElementById('analytics-grid').innerHTML = `
                <div class="stat-card"><i class="bi bi-stack"></i><div class="stat-number">${data.totalTasks}</div><div class="stat-title">Total de Tarefas</div></div>
                <div class="stat-card"><i class="bi bi-hourglass-split" style="color: #ffc107;"></i><div class="stat-number">${data.pendingTasks}</div><div class="stat-title">Tarefas Pendentes</div></div>
                <div class="stat-card"><i class="bi bi-check2-circle" style="color: #198754;"></i><div class="stat-number">${data.completedTasks}</div><div class="stat-title">Tarefas Concluídas</div></div>
                <div class="stat-card"><i class="bi bi-calendar-x" style="color: #dc3545;"></i><div class="stat-number">${data.overdueTasks}</div><div class="stat-title">Tarefas Atrasadas</div></div>
                <div class="stat-card col-span-2"><i class="bi bi-person-check-fill" style="color: #0dcaf0;"></i><div class="stat-number">${data.topUser.username}</div><div class="stat-title">Top Funcionário (${data.topUser.task_count} tarefas)</div></div>`;
        } catch (error) {
             document.getElementById('analytics-grid').innerHTML = `<p class="text-danger">${error.message}</p>`;
        }
    }

    // --- TEAM VIEW ---
    async function renderTeamView() {
        mainContent.innerHTML = `
            <div class="content-header"><h2>Membros da Equipe</h2></div>
            <div id="team-list" class="team-grid"><div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div></div>`;
        try {
            const response = await fetch(`${API_URL}/users/employees`);
            if (!response.ok) throw new Error('Não foi possível carregar a lista de funcionários.');
            const employees = await response.json();
            const listEl = document.getElementById('team-list');
            listEl.innerHTML = '';
            if (employees.length === 0) { listEl.innerHTML = '<p class="text-muted">Nenhum funcionário encontrado.</p>'; return; }
            employees.forEach(emp => {
                listEl.innerHTML += `<div class="team-card"><div class="team-card-icon"><i class="bi bi-person"></i></div><div class="team-card-info"><p class="name">${emp.username}</p><p class="title">${emp.job_title || 'Funcionário'}</p><p class="email">${emp.email}</p></div></div>`;
            });
        } catch (error) {
            document.getElementById('team-list').innerHTML = `<p class="text-danger">${error.message}</p>`;
        }
    }
    
    // --- ACTIVITY LOG VIEW ---
    async function renderActivityLogView() {
        mainContent.innerHTML = `
            <div class="content-header">
                <h2>Log de Atividades do Sistema</h2>
            </div>
            <div class="card">
                <div class="card-body">
                    <div id="activity-log-container" class="table-responsive">
                        <div class="text-center p-5"><div class="spinner-border text-primary" role="status"></div></div>
                    </div>
                </div>
            </div>`;
        
        try {
            const response = await fetch(`${API_URL}/activity-log`);
            if (!response.ok) throw new Error('Não foi possível carregar o log de atividades.');
            const logs = await response.json();
            
            const container = document.getElementById('activity-log-container');
            if (logs.length === 0) {
                container.innerHTML = '<p class="text-muted text-center">Nenhuma atividade registrada.</p>';
                return;
            }
            
            let tableHtml = `
                <table class="table table-striped table-hover activity-log-table">
                    <thead class="table-light">
                        <tr>
                            <th scope="col">Usuário</th>
                            <th scope="col">Ação</th>
                            <th scope="col">Data e Hora</th>
                        </tr>
                    </thead>
                    <tbody>`;
            
            logs.forEach(log => {
                const timestamp = new Date(log.timestamp).toLocaleString('pt-BR');
                tableHtml += `
                    <tr>
                        <td><strong>${log.username || '[desconhecido]'}</strong></td>
                        <td>${log.action_text}</td>
                        <td class="text-muted small">${timestamp}</td>
                    </tr>`;
            });
            
            tableHtml += `</tbody></table>`;
            container.innerHTML = tableHtml;
            
        } catch (error) {
            document.getElementById('activity-log-container').innerHTML = `<p class="text-danger">${error.message}</p>`;
        }
    }


    // --- RENDERIZAÇÃO DAS TAREFAS ---
    function renderTasks() {
        const searchTerm = document.getElementById('task-search-input')?.value.toLowerCase() || '';
        const filteredBySearch = allTasks.filter(task => (task.title || '').toLowerCase().includes(searchTerm) || (task.description || '').toLowerCase().includes(searchTerm));
        const tasksToRender = filteredBySearch.filter(task => {
            if (currentFilter === 'mine') return task.assigned_to_id === currentUser.id;
            if (currentFilter === 'overdue') return !task.completed && task.due_date && new Date(task.due_date) < new Date();
            return true;
        });
        const taskList = mainContent.querySelector('#task-list');
        if (!taskList) return;
        taskList.innerHTML = tasksToRender.length === 0 ? '<p class="text-center text-muted">Nenhuma tarefa encontrada.</p>' : '';
        tasksToRender.forEach(task => {
            const priority = {1:{bg:'danger',txt:'Alta'}, 2:{bg:'warning',txt:'Média'}, 3:{bg:'success',txt:'Baixa'}}[task.priority] || {bg:'secondary', txt:'Média'};
            const isOverdue = !task.completed && task.due_date && new Date(task.due_date) < new Date();
            const adminButtons = currentUser.role === 'admin' ? `<button class="btn btn-outline-secondary" title="Editar" data-action="edit" data-id="${task.id}"><i class="bi bi-pencil"></i></button><button class="btn btn-outline-danger" title="Excluir" data-action="delete" data-id="${task.id}"><i class="bi bi-trash"></i></button>` : '';
            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-4';
            const completedStr = task.completed ? 'true' : 'false';
            card.innerHTML = `
                <div class="card h-100 task-card ${task.completed ? 'completed-task' : ''}">
                    <div class="task-actions">
                        ${adminButtons}
                        <button class="btn btn-outline-info" title="Comentários" data-action="comments" data-id="${task.id}"><i class="bi bi-chat-left-text"></i></button>
                        <button class="${task.completed ? 'btn btn-outline-secondary' : 'btn btn-success'}" title="${task.completed ? 'Reabrir' : 'Concluir'}" data-action="toggle-complete" data-id="${task.id}" data-completed="${completedStr}">
                            <i class="bi ${task.completed ? 'bi-x-lg' : 'bi-check-lg'}"></i>
                        </button>
                    </div>
                    <div class="card-body">
                        <div class="d-flex justify-content-between">
                            <h5 class="card-title">${task.title}</h5>
                            <span class="badge bg-${priority.bg}-subtle text-${priority.bg}-emphasis p-2">${priority.txt}</span>
                        </div>
                        <p class="card-text text-muted small">${task.description || ''}</p>
                        <div class="small text-muted"><b>Prazo:</b> ${task.due_date ? new Date(task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'N/A'} ${isOverdue ? '<span class="badge bg-danger ms-2">Atrasada</span>' : ''}</div>
                        <div class="small text-muted mt-1"><b>Para:</b> ${task.assignee_name || 'Ninguém'}</div>
                        <div class="small text-muted mt-3"><b>Criado por:</b> ${task.creator_name || 'N/A'}</div>
                    </div>
                </div>`;
            taskList.appendChild(card);
        });
    }

    // --- MODAIS / CHAT / HELPERS (inicialização) ---
    function initializeModalsAndChat() {
        if (!editTaskModal) {
            const el = document.getElementById('editTaskModal');
            el.innerHTML = `<div class="modal-dialog modal-lg"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Editar Tarefa</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><form id="edit-task-form"></form></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button type="submit" form="edit-task-form" class="btn btn-primary">Salvar</button></div></div></div>`;
            editTaskModal = new bootstrap.Modal(el);
            el.querySelector('#edit-task-form').addEventListener('submit', handleEditTask);
        }
        if (!commentsModal) {
            const el = document.getElementById('commentsModal');
            el.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Comentários</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div id="comments-list" class="mb-3" style="max-height: 400px; overflow-y: auto;"></div><form id="comment-form"><input type="hidden" id="comment-task-id"><div class="input-group"><input type="text" id="comment-input" class="form-control" placeholder="Adicionar comentário..." required autocomplete="off"><button class="btn btn-outline-primary" type="submit">Enviar</button></div></form></div></div></div>`;
            commentsModal = new bootstrap.Modal(el);
            el.querySelector('#comment-form').addEventListener('submit', handleAddComment);
        }
        if (!confirmationModal) {
            const el = document.getElementById('confirmationModal');
            el.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Confirmar Ação</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><p id="confirmation-modal-body"></p></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button type="button" id="confirm-action-btn" class="btn btn-danger">Confirmar</button></div></div></div>`;
            confirmationModal = new bootstrap.Modal(el);
        }

        const chat = document.getElementById('chat-container');
        if (!chat.innerHTML.trim()) {
            chat.innerHTML = `
                <div id="chat-bubble"><i class="bi bi-chat-dots-fill"></i></div>
                <div id="chat-window">
                    <div class="chat-header">Chat da Equipe</div>
                    <div id="chat-messages"></div>
                    <form id="chat-form">
                        <input type="text" id="chat-input" class="form-control" placeholder="Digite sua mensagem..." autocomplete="off">
                        <button type="submit" class="btn btn-primary ms-2"><i class="bi bi-send-fill"></i></button>
                    </form>
                </div>`;

            const chatBubble = chat.querySelector('#chat-bubble');
            const chatWindow = document.getElementById('chat-window');

            chatBubble.addEventListener('click', async () => {
                const isOpen = window.getComputedStyle(chatWindow).display === 'flex';
                chatWindow.style.display = isOpen ? 'none' : 'flex';

                if (!isOpen) {
                    try {
                        await renderChatMessages();
                    } catch (err) {
                        console.error('Erro ao carregar mensagens do chat:', err);
                    }
                }
            });

            chat.querySelector('#chat-form').addEventListener('submit', handleSendChatMessage);
        }
    }


    // --- UTIL: popula dropdown de responsáveis ---
    async function populateAssigneeDropdown(selectElement) {
        try {
            const res = await fetch(`${API_URL}/users/employees`);
            if (!res.ok) throw new Error('Falha ao buscar funcionários');
            const employees = await res.json();
            selectElement.innerHTML = '<option value="">Ninguém</option>';
            employees.forEach(emp => selectElement.innerHTML += `<option value="${emp.id}">${emp.username}</option>`);
        } catch (error) {
            console.error(error.message);
        }
    }

    function handleFilterClick(e) {
        if (e.target.tagName === 'BUTTON') {
            mainContent.querySelector('.task-filters .active').classList.remove('active');
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderTasks();
        }
    }

    // --- BUSCA E RENDERIZAÇÃO DAS TAREFAS (faz fetch e popula allTasks) ---
    async function fetchAndRenderTasks() {
        try {
            const res = await fetch(`${API_URL}/tasks`);
            if (!res.ok) throw new Error('Falha ao carregar tarefas');
            allTasks = await res.json();
            renderTasks();
        } catch (error) {
            const list = mainContent.querySelector('#task-list');
            if (list) list.innerHTML = `<p class="text-center text-danger">${error.message}</p>`;
        }
    }

    // --- CLICK HANDLER GERAL PARA OS BOTOES DENTRO DA LISTA ---
    function handleTaskListClick(e) {
        const button = e.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        const taskId = parseInt(button.dataset.id);
        const actions = {
            'edit': () => handleOpenEditModal(taskId),
            'delete': () => handleDeleteTask(taskId),
            'comments': () => handleOpenCommentsModal(taskId),
            'toggle-complete': () => handleToggleComplete(taskId)
        };
        if (actions[action]) actions[action]();
    }

    async function handleAddTask(e) {
        e.preventDefault();
        const assigneeId = document.getElementById('assign-to').value;
        const taskData = {
            title: document.getElementById('task-title').value,
            description: document.getElementById('task-description').value,
            priority: parseInt(document.getElementById('task-priority').value),
            due_date: document.getElementById('task-due-date').value || null,
            creator_id: currentUser.id,
            assigned_to_id: assigneeId ? parseInt(assigneeId) : null
        };
        try {
            const res = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao criar tarefa');
            e.target.reset();
            fetchAndRenderTasks();
        } catch (error) {
            alert(`Erro: ${error.message}`);
        }
    }

    async function handleEditTask(e) {
        e.preventDefault();
        const form = e.target;
        const taskId = parseInt(form.dataset.taskId);
        const assigneeId = form.elements['edit-assign-to'].value;
        const taskData = {
            title: form.elements['edit-task-title'].value,
            description: form.elements['edit-task-description'].value,
            priority: parseInt(form.elements['edit-task-priority'].value),
            due_date: form.elements['edit-task-due-date'].value || null,
            assigned_to_id: assigneeId ? parseInt(assigneeId) : null,
            acting_user_id: currentUser.id
        };
        try {
            const res = await fetch(`${API_URL}/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao editar tarefa');
            editTaskModal.hide();
            fetchAndRenderTasks();
        } catch (error) {
            alert(`Erro: ${error.message}`);
        }
    }

    async function handleToggleComplete(taskId) {
        try {
            let task = allTasks.find(t => t.id === taskId);
            if (!task) {
                const resTask = await fetch(`${API_URL}/tasks/${taskId}`);
                if (!resTask.ok) throw new Error('Não foi possível obter o estado da tarefa.');
                task = await resTask.json();
            }

            const currentCompleted = !!task.completed;
            const payload = { 
                completed: !currentCompleted,
                acting_user_id: currentUser.id
            };
            
            const res = await fetch(`${API_URL}/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || data.message || 'Erro ao alternar conclusão');
            await fetchAndRenderTasks();
        } catch (error) {
            alert(`Erro: ${error.message}`);
        }
    }

    function handleDeleteTask(taskId) {
        const confirmationText = 'Tem certeza que deseja excluir esta tarefa? Esta ação não pode ser desfeita.';
        const confirmModalEl = document.getElementById('confirmationModal');
        const confirmationBody = document.getElementById('confirmation-modal-body');
        const confirmBtnOriginal = document.getElementById('confirm-action-btn');

        const performDelete = async () => {
            try {
                const res = await fetch(`${API_URL}/tasks/${taskId}`, { 
                    method: 'DELETE', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acting_user_id: currentUser.id })
                });
                let data;
                try { data = await res.json(); } catch (e) { data = {}; }
                if (!res.ok) {
                    alert(data.error || data.message || 'Não foi possível excluir a tarefa.');
                    return;
                }
                if (typeof confirmationModal !== 'undefined' && confirmationModal) {
                    try { confirmationModal.hide(); } catch (err) {}
                }
                if (typeof fetchAndRenderTasks === 'function') fetchAndRenderTasks();
                alert(data.message || 'Tarefa excluída com sucesso.');
            } catch (err) {
                alert('Erro ao conectar com o servidor.');
            }
        };

        if (confirmModalEl && confirmationBody && confirmBtnOriginal && typeof confirmationModal !== 'undefined') {
            confirmationBody.textContent = confirmationText;
            const confirmBtnClone = confirmBtnOriginal.cloneNode(true);
            confirmBtnOriginal.parentNode.replaceChild(confirmBtnClone, confirmBtnOriginal);
            confirmBtnClone.addEventListener('click', async () => { await performDelete(); }, { once: true });
            try { confirmationModal.show(); } catch (err) { if (confirm(confirmationText)) performDelete(); }
            return;
        }

        if (confirm(confirmationText)) performDelete();
    }

    async function handleOpenEditModal(taskId) {
        try {
            const res = await fetch(`${API_URL}/tasks/${taskId}`);
            if (!res.ok) throw new Error('Não foi possível carregar os dados da tarefa.');
            const task = await res.json();
            const form = document.getElementById('edit-task-form');
            form.dataset.taskId = taskId;
            form.innerHTML = `<div class="row g-3">
                <div class="col-12"><label class="form-label">Título</label><input type="text" id="edit-task-title" class="form-control" value="${task.title}" required></div>
                <div class="col-md-6"><label class="form-label">Prioridade</label><select id="edit-task-priority" class="form-select"></select></div>
                <div class="col-md-6"><label class="form-label">Prazo</label><input type="date" id="edit-task-due-date" class="form-control" value="${task.due_date ? task.due_date.split('T')[0] : ''}"></div>
                <div class="col-12"><label class="form-label">Descrição</label><textarea id="edit-task-description" class="form-control" rows="3" required>${task.description || ''}</textarea></div>
                <div class="col-12"><label class="form-label">Atribuir para:</label><select id="edit-assign-to" class="form-select"><option value="">Ninguém</option></select></div>
            </div>`;
            const prioritySelect = form.elements['edit-task-priority'];
            prioritySelect.innerHTML = `<option value="1">Alta</option><option value="2">Média</option><option value="3">Baixa</option>`;
            prioritySelect.value = task.priority;
            const assigneeSelect = form.elements['edit-assign-to'];
            await populateAssigneeDropdown(assigneeSelect);
            assigneeSelect.value = task.assigned_to_id || "";
            editTaskModal.show();
        } catch (error) {
            alert(error.message);
        }
    }

    async function handleOpenCommentsModal(taskId) {
        document.getElementById('comment-task-id').value = taskId;
        await renderComments(taskId);
        commentsModal.show();
    }
    async function renderComments(taskId) {
        try {
            const res = await fetch(`${API_URL}/tasks/${taskId}/comments`);
            if (!res.ok) throw new Error('Não foi possível carregar os comentários.');
            const comments = await res.json();
            const listEl = document.getElementById('comments-list');
            listEl.innerHTML = comments.length === 0 ? '<p class="text-muted text-center">Nenhum comentário ainda.</p>' : '';
            comments.forEach(c => listEl.innerHTML += `<div class="comment"><p class="mb-1"><strong>${c.username}:</strong> ${c.text}</p><small class="text-muted">${new Date(c.timestamp).toLocaleString('pt-BR')}</small></div>`);
            listEl.scrollTop = listEl.scrollHeight;
        } catch (error) {
            alert(error.message);
        }
    }
    async function handleAddComment(e) {
        e.preventDefault();
        const taskId = parseInt(document.getElementById('comment-task-id').value);
        const text = document.getElementById('comment-input').value.trim();
        if (!text) return;
        try {
            const res = await fetch(`${API_URL}/tasks/${taskId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.id, text })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao adicionar comentário');
            document.getElementById('comment-input').value = '';
            await renderComments(taskId);
            await fetchAndRenderTasks();
        } catch (error) {
            alert(`Erro: ${error.message}`);
        }
    }

    async function handleSendChatMessage(e) {
        e.preventDefault();
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;
        try {
            const res = await fetch(`${API_URL}/chat/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.id, text })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Erro ao enviar mensagem');
            input.value = '';
            await renderChatMessages();
        } catch (error) {
            alert(`Erro: ${error.message}`);
        }
    }

    async function renderChatMessages() {
        try {
            const res = await fetch(`${API_URL}/chat/messages`);
            if (!res.ok) throw new Error('Não foi possível carregar mensagens do chat.');
            const messages = await res.json();
            const messagesEl = document.getElementById('chat-messages');
            messagesEl.innerHTML = '';
            messages.forEach(msg => messagesEl.innerHTML += `<div class="p-2"><strong>${msg.username}:</strong> ${msg.text}</div>`);
            messagesEl.scrollTop = messagesEl.scrollHeight;
        } catch (error) {
            alert(error.message);
        }
    }
    
});
