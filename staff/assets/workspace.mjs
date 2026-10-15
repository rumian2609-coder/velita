import {createEmptyWorkspace, createRecord, updateRecord, deleteRecord, exportWorkspace, parseBackup, PROJECT_STAGES, TASK_STATUSES, MAX_BACKUP_LENGTH} from './workspace-core.mjs';
import {createWorkspaceStore} from './workspace-store.mjs';

const mounted = new WeakMap();
const signatureImage = new URL('./signature-home.jpg', import.meta.url).href;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const today = () => {const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel = value => value ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`)) : '';
const updatedLabel = value => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(new Date(value));
const optionsHTML = (values, selected, empty) => `${empty ? `<option value="">${escapeHTML(empty)}</option>` : ''}${values.map(value => {const v = typeof value === 'string' ? value : value.id; const label = typeof value === 'string' ? value : value.title; return `<option value="${escapeHTML(v)}"${v === selected ? ' selected' : ''}>${escapeHTML(label)}</option>`;}).join('')}`;
const stageHTML = value => `<span class="stage" data-stage="${escapeHTML(value)}">${escapeHTML(value)}</span>`;
const emptyHTML = (title, copy, action = '') => `<div class="surface empty-state"><h3>${title}</h3><p>${copy}</p>${action}</div>`;
const collection = kind => ({project:'projects',task:'tasks',note:'notes'}[kind]);

/** Auth-independent UI. Production passes only a Firebase-provided UID. */
export function mountWorkspace(root, {uid, email = '', preview = false, store = createWorkspaceStore(uid), storage = globalThis.localStorage, storageEventKey = store.key} = {}) {
  if (!root || !uid) throw new Error('A signed-in account is required to open the workspace.');
  mounted.get(root)?.destroy();
  const controller = new AbortController();
  const signal = controller.signal;
  const shell = root.closest('[data-workspace-shell]') || document;
  const nav = shell.querySelector('[data-workspace-nav]');
  const saveStatus = shell.querySelector('#saveStatus');
  let data, view = 'overview', detailId = '', search = '', stageFilter = '', statusFilter = '', projectFilter = '', showArchived = false, toastTimer, externalPending = false, lastSaveError = '';
  const dialog = document.createElement('dialog');
  dialog.className = 'workspace-dialog';
  dialog.setAttribute('aria-labelledby','dialogTitle');
  document.body.append(dialog);
  const toast = document.createElement('div');
  toast.className = 'toast'; toast.setAttribute('role','status'); toast.setAttribute('aria-live','polite'); toast.hidden = true;
  document.body.append(toast);

  function notify(message, error = false) {
    clearTimeout(toastTimer); toast.textContent = message; toast.classList.toggle('error',error); toast.hidden = false;
    toastTimer = setTimeout(() => {toast.hidden = true;},error ? 8000 : 4200);
  }
  function status(message) {if (saveStatus) saveStatus.textContent = message;}
  function dialogError(message) {const box=dialog.querySelector('[data-form-error], [data-confirm-error]');if(box){box.textContent=message;box.hidden=false;}}
  function getProject(id) {return data?.projects.find(project => project.id === id);}
  function projectName(id) {return getProject(id)?.title || '';}
  function tasksFor(id) {return data.tasks.filter(task => task.projectId === id);}
  function activeProjects() {return data.projects.filter(project => !project.archived);}
  function sorted(records) {return [...records].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));}
  function matches(...values) {return values.join(' ').toLowerCase().includes(search.toLowerCase().trim());}
  function projectSelect(selected = '') {return optionsHTML(sorted(data.projects),selected,'No project');}
  function header(title, copy, action = '') {return `<header class="view-header"><div><h1 id="viewTitle" tabindex="-1">${title}</h1>${copy ? `<p>${copy}</p>` : ''}</div>${action ? `<div class="header-actions">${action}</div>` : ''}</header>`;}
  function actionButton(action,label,secondary = false,extra = '') {return `<button type="button" class="button${secondary ? ' secondary' : ''}" data-action="${action}" ${extra}>${label}</button>`;}
  function recordButton(kind,record) {return `<button type="button" class="record-title" data-action="${kind === 'project' ? 'open-project' : `edit-${kind}`}" data-id="${escapeHTML(record.id)}">${escapeHTML(record.title)}</button>`;}
  function projectRow(project) {const tasks = tasksFor(project.id); return `<article class="project-row"><div>${recordButton('project',project)}<p class="record-meta">${tasks.filter(task=>task.status !== 'Done').length} open tasks</p></div>${stageHTML(project.archived ? 'Archived' : project.stage)}</article>`;}
  function taskRow(task,full = false) {const project = projectName(task.projectId); const overdue = task.dueDate && task.dueDate < today() && task.status !== 'Done'; return `<article class="task-row${task.status === 'Done' ? ' done' : ''}"><input type="checkbox" class="task-check" data-task-toggle="${escapeHTML(task.id)}" aria-label="Mark ${escapeHTML(task.title)} ${task.status === 'Done' ? 'incomplete' : 'complete'}"${task.status === 'Done' ? ' checked' : ''}><div>${recordButton('task',task)}<div class="task-info">${project ? `<span>${escapeHTML(project)}</span>` : ''}${task.dueDate ? `<span class="task-due${overdue ? ' overdue' : ''}">${overdue ? 'Overdue · ' : ''}${dateLabel(task.dueDate)}</span>` : ''}${!full ? stageHTML(task.status) : ''}</div></div>${full ? `<select class="task-status" aria-label="Status for ${escapeHTML(task.title)}" data-task-status="${escapeHTML(task.id)}">${optionsHTML(TASK_STATUSES,task.status)}</select>` : ''}</article>`;}
  function noteRow(note) {return `<article class="note-row">${recordButton('note',note)}<p class="note-excerpt">${escapeHTML(note.body || 'No content yet.')}</p><p class="record-meta">${note.projectId ? `${escapeHTML(projectName(note.projectId))} · ` : ''}Updated ${updatedLabel(note.updatedAt)}</p></article>`;}

  function overviewHTML() {
    const projects = sorted(activeProjects());
    const openTasks = data.tasks.filter(task => task.status !== 'Done').sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.updatedAt.localeCompare(a.updatedAt));
    return `${header('Overview','Your ideas, plans and work in one place.',actionButton('new-project','New project'))}
      <section class="studio-banner" aria-label="Velita studio"><img src="${signatureImage}" alt="" aria-hidden="true"><h2>Ideas,<br>in progress.</h2><p>A private space for the things<br>you’re bringing to life.</p></section>
      <div class="metrics" aria-label="Workspace summary"><div class="metric"><strong>${projects.length}</strong><span>Active projects</span></div><div class="metric"><strong>${openTasks.length}</strong><span>Open tasks</span></div><div class="metric"><strong>${data.notes.length}</strong><span>Studio notes</span></div></div>
      <div class="overview-columns"><section><div class="section-heading"><h2>Projects</h2><button type="button" class="section-link" data-view="projects">View all</button></div>${projects.length ? `<div class="surface">${projects.slice(0,4).map(projectRow).join('')}</div>` : emptyHTML('A place for your next idea.','Create a project when there’s something you want to explore.')}</section>
      <div class="section-stack"><section><div class="section-heading"><h2>Up next</h2><button type="button" class="section-link" data-view="tasks">View tasks</button></div>${openTasks.length ? `<div class="surface">${openTasks.slice(0,3).map(task=>taskRow(task)).join('')}</div>` : emptyHTML('A clear head, a clear list.','Add the next few things you want to get done.',actionButton('new-task','Add a task',true))}</section>
      <section><div class="section-heading"><h2>Recent notes</h2><button type="button" class="section-link" data-view="notes">View notes</button></div>${data.notes.length ? `<div class="surface">${sorted(data.notes).slice(0,2).map(noteRow).join('')}</div>` : emptyHTML('Keep a thought.','Save an idea, a decision or something worth remembering.',actionButton('new-note','Write a note',true))}</section></div></div>`;
  }
  function projectsHTML() {
    const projects = sorted(data.projects).filter(project => (showArchived || !project.archived) && (!stageFilter || project.stage === stageFilter) && matches(project.title,project.description));
    return `${header('Projects','Give each idea room to develop.',actionButton('new-project','New project'))}<div class="toolbar"><div class="search"><label class="sr-only" for="workspaceSearch">Search projects</label><input id="workspaceSearch" type="search" placeholder="Search projects" value="${escapeHTML(search)}" data-search></div><label class="sr-only" for="stageFilter">Project stage</label><select id="stageFilter" data-filter="stage">${optionsHTML(PROJECT_STAGES,stageFilter,'All stages')}</select><label class="check-label"><input type="checkbox" data-filter="archived"${showArchived ? ' checked' : ''}>Include archived</label></div><div data-results>${projectsResults(projects)}</div>`;
  }
  function projectsResults(projects) {return projects.length ? `<div class="project-grid">${projects.map(project => {const tasks = tasksFor(project.id);const done = tasks.filter(task => task.status === 'Done').length;return `<article class="surface project-card">${stageHTML(project.archived ? 'Archived' : project.stage)}${recordButton('project',project)}<p class="description">${escapeHTML(project.description || 'An idea with room to grow.')}</p><div class="project-progress">${tasks.length ? `${done} of ${tasks.length} tasks complete` : 'No tasks yet'}<progress value="${done}" max="${tasks.length || 1}" aria-label="${escapeHTML(project.title)} task completion"></progress></div></article>`;}).join('')}</div>` : emptyHTML(search || stageFilter || showArchived ? 'No matching projects.' : 'Start with an idea.',search || stageFilter || showArchived ? 'Try another search or change your filters.' : 'Create your first project to keep its plans, tasks and notes together.');}
  function projectDetailHTML() {
    const project = getProject(detailId); if (!project) {view='projects';return projectsHTML();}
    const tasks = tasksFor(project.id); const notes = sorted(data.notes.filter(note => note.projectId === project.id));
    return `<button type="button" class="back-button" data-view="projects">Back to projects</button>${header(escapeHTML(project.title),'',`${actionButton('edit-project','Edit project',true,`data-id="${escapeHTML(project.id)}"`)}${actionButton('archive-project',project.archived ? 'Restore' : 'Archive',true,`data-id="${escapeHTML(project.id)}"`)}`)}<div class="detail-meta">${stageHTML(project.archived ? 'Archived' : project.stage)}<span>Updated ${updatedLabel(project.updatedAt)}</span></div><p class="detail-description" style="margin-top:24px">${escapeHTML(project.description || 'Add a short description to capture what this project is about.')}</p><div class="detail-columns"><section><div class="section-heading"><h2>Tasks</h2><button type="button" class="section-link" data-action="new-task" data-project="${escapeHTML(project.id)}">Add task</button></div>${tasks.length ? `<div class="surface task-list full">${sorted(tasks).map(task=>taskRow(task,true)).join('')}</div>` : emptyHTML('One step at a time.','Add a task for the next thing this project needs.')}</section><section><div class="section-heading"><h2>Notes</h2><button type="button" class="section-link" data-action="new-note" data-project="${escapeHTML(project.id)}">Write note</button></div>${notes.length ? `<div class="surface">${notes.map(noteRow).join('')}</div>` : emptyHTML('Keep the thinking close.','Save ideas and decisions alongside this project.')}</section></div>`;
  }
  function tasksHTML() {
    return `${header('Tasks','The next step, and the one after.',actionButton('new-task','New task'))}<div class="toolbar"><div class="search"><label class="sr-only" for="workspaceSearch">Search tasks</label><input id="workspaceSearch" type="search" placeholder="Search tasks" value="${escapeHTML(search)}" data-search></div><label class="sr-only" for="statusFilter">Task status</label><select id="statusFilter" data-filter="status">${optionsHTML(TASK_STATUSES,statusFilter,'All statuses')}</select><label class="sr-only" for="projectFilter">Filter by project</label><select id="projectFilter" data-filter="project">${optionsHTML(sorted(data.projects),projectFilter,'All projects')}</select></div><div data-results>${tasksResults()}</div>`;
  }
  function tasksResults() {const tasks = sorted(data.tasks).filter(task => (!statusFilter || task.status === statusFilter) && (!projectFilter || task.projectId === projectFilter) && matches(task.title,projectName(task.projectId))).sort((a,b)=>(a.status === 'Done')-(b.status === 'Done'));return tasks.length ? `<div class="surface task-list full">${tasks.map(task=>taskRow(task,true)).join('')}</div>` : emptyHTML(search || statusFilter || projectFilter ? 'No matching tasks.' : 'A little clarity goes a long way.',search || statusFilter || projectFilter ? 'Try another search or change your filters.' : 'Add a task, choose a project if you like, and take it from there.');}
  function notesHTML() {return `${header('Notes','Keep the thinking, not just the to-do list.',actionButton('new-note','Write a note'))}<div class="toolbar"><div class="search"><label class="sr-only" for="workspaceSearch">Search notes</label><input id="workspaceSearch" type="search" placeholder="Search notes" value="${escapeHTML(search)}" data-search></div><label class="sr-only" for="projectFilter">Filter by project</label><select id="projectFilter" data-filter="project">${optionsHTML(sorted(data.projects),projectFilter,'All projects')}</select></div><div data-results>${notesResults()}</div>`;}
  function notesResults() {const notes = sorted(data.notes).filter(note=>(!projectFilter || note.projectId === projectFilter) && matches(note.title,note.body,projectName(note.projectId)));return notes.length ? `<div class="note-grid">${notes.map(note=>`<article class="surface note-card">${recordButton('note',note)}<p class="note-excerpt">${escapeHTML(note.body || 'No content yet.')}</p><p class="record-meta">${note.projectId ? `${escapeHTML(projectName(note.projectId))} · ` : ''}Updated ${updatedLabel(note.updatedAt)}</p></article>`).join('')}</div>` : emptyHTML(search || projectFilter ? 'No matching notes.' : 'Some thoughts are worth keeping.',search || projectFilter ? 'Try another search or change your filters.' : 'Use this space for ideas, decisions, research and useful links.');}
  function settingsHTML() {return `${header('Settings','Your account and your workspace data.')}<div class="settings-stack"><section class="surface settings-panel"><h2>Account</h2><dl class="account-details"><dt>Signed in as</dt><dd>${escapeHTML(email || 'Local preview')}</dd><dt>Access</dt><dd>${preview ? 'Preview environment' : 'Existing Velita Firebase account'}</dd></dl><p style="margin-top:20px">To reset your password, sign out and use “Forgot password?” on the staff sign-in page.</p></section><section class="surface settings-panel"><h2>Saved on this device</h2><p>Your projects, tasks and notes are saved in this browser, separately for your signed-in account. They do not sync to other devices. Clearing browser data can remove them.</p><p style="margin-top:12px">This is not an encrypted vault. Keep passwords, API keys and other secrets elsewhere.</p></section><section class="surface settings-panel"><h2>Backups</h2><p>Export a copy to keep your work safe or move it to another browser. Importing a backup replaces this account’s workspace in this browser; it does not merge records.</p><div class="header-actions">${actionButton('export','Export backup')}${actionButton('import','Import backup',true)}</div><p style="margin-top:16px;font-size:12px">${data.projects.length} projects · ${data.tasks.length} tasks · ${data.notes.length} notes</p></section><section class="surface settings-panel danger-zone"><h2>Clear workspace</h2><p>Remove the saved projects, tasks and notes for this account from this browser. Your login and other accounts are not affected. Export a backup first.</p><div class="header-actions">${actionButton('clear','Clear workspace',true)}</div></section></div>`;}

  function render(focus = false) {
    if (signal.aborted || !data) return;
    const active=document.activeElement;
    const focusSelector=active&&root.contains(active) ? active.dataset.taskToggle ? `[data-task-toggle="${CSS.escape(active.dataset.taskToggle)}"]` : active.dataset.taskStatus ? `[data-task-status="${CSS.escape(active.dataset.taskStatus)}"]` : active.dataset.action&&active.dataset.id ? `[data-action="${CSS.escape(active.dataset.action)}"][data-id="${CSS.escape(active.dataset.id)}"]` : null : null;
    nav?.querySelectorAll('[data-view]').forEach(button=>{if(button.dataset.view === (view === 'project' ? 'projects' : view)) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');});
    const html = {overview:overviewHTML,projects:projectsHTML,project:projectDetailHTML,tasks:tasksHTML,notes:notesHTML,settings:settingsHTML}[view]();
    root.innerHTML = `<div class="view-content">${html}</div>`;
    if(!focus&&focusSelector)root.querySelector(focusSelector)?.focus({preventScroll:true});
    if (focus) {root.querySelector('#viewTitle')?.focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'});}
  }
  function showView(next) {if (!['overview','projects','tasks','notes','settings'].includes(next)) return;view=next;search='';stageFilter='';statusFilter='';projectFilter='';showArchived=false;detailId='';render(true);}
  function refreshResults() {const results=root.querySelector('[data-results]');if(!results)return;if(view==='projects')results.innerHTML=projectsResults(sorted(data.projects).filter(project=>(showArchived || !project.archived)&&(!stageFilter || project.stage===stageFilter)&&matches(project.title,project.description)));if(view==='tasks')results.innerHTML=tasksResults();if(view==='notes')results.innerHTML=notesResults();}
  async function commit(next, message, replace = false) {
    const expected=JSON.stringify(data);lastSaveError='';
    const write=()=>{
      if(signal.aborted)return false;
      if (externalPending && !replace) throw new Error('This workspace changed in another tab. Close this editor and reopen it before saving.');
      if (!replace && JSON.stringify(store.load()) !== expected) {externalPending=true;throw new Error('This workspace changed in another tab. Close this editor and reopen it before saving.');}
      store.save(next);data=next;status('Saved on this device');render();notify(message);return true;
    };
    try {
      status('Saving…');
      return globalThis.navigator?.locks ? await navigator.locks.request(`velita-write:${storageEventKey}`,{signal},write) : write();
    } catch(error) {if(!signal.aborted){lastSaveError=error.message || 'Could not save. Export a backup and check browser storage.';status('Not saved');notify(lastSaveError,true);}return false;}
  }
  function openDialog(title, body) {if(dialog.open)dialog.close();dialog.innerHTML=`<div class="dialog-inner"><div class="dialog-heading"><h2 id="dialogTitle">${title}</h2><button type="button" class="close-dialog" data-close>Close</button></div>${body}</div>`;const firstInput=dialog.querySelector('input[name="title"]');if(firstInput)firstInput.autofocus=true;dialog.showModal();}
  function closeDialog() {dialog.close();root.querySelector('#viewTitle')?.focus({preventScroll:true});}
  function field(label,name,content,hint='') {const id=`dialog-field-${name}`;const control=content.replace(/<(input|select|textarea)\b/,`<$1 id="${id}"${hint ? ` aria-describedby="${id}-hint"` : ''}`);return `<div class="form-field"><label class="field-label" for="${id}">${label}</label>${control}${hint ? `<small id="${id}-hint">${hint}</small>` : ''}</div>`;}
  function recordDialog(kind,id = '',defaultProject = '') {
    const record = id ? data[collection(kind)].find(item=>item.id===id) : null;
    if(id&&!record) return;
    const title = record ? `Edit ${kind}` : kind === 'note' ? 'Write a note' : `New ${kind}`;
    let fields = field('Title','title',`<input name="title" required maxlength="120" value="${escapeHTML(record?.title || '')}" autocomplete="off" placeholder="${kind==='project' ? 'What are you exploring?' : kind==='task' ? 'What needs doing?' : 'Give this thought a name'}">`);
    if(kind==='project') fields += field('Description','description',`<textarea name="description" maxlength="2000" rows="4" placeholder="A few words about the idea.">${escapeHTML(record?.description || '')}</textarea>`) + field('Stage','stage',`<select name="stage">${optionsHTML(PROJECT_STAGES,record?.stage || 'Exploring')}</select>`);
    if(kind==='task') fields += field('Project','projectId',`<select name="projectId">${projectSelect(record?.projectId || defaultProject)}</select>`) + `<div class="form-row">${field('Status','status',`<select name="status">${optionsHTML(TASK_STATUSES,record?.status || 'To do')}</select>`)}${field('Due date (optional)','dueDate',`<input type="date" name="dueDate" value="${escapeHTML(record?.dueDate || '')}">`)}</div>`;
    if(kind==='note') fields += field('Note','body',`<textarea class="note-body" name="body" maxlength="20000" rows="9" placeholder="An idea, a decision, a useful link…">${escapeHTML(record?.body || '')}</textarea>`,'Plain text. Links are kept as written.') + field('Project','projectId',`<select name="projectId">${projectSelect(record?.projectId || defaultProject)}</select>`);
    openDialog(title,`<form data-record-form data-kind="${kind}" data-id="${escapeHTML(id)}">${fields}<p class="form-error" data-form-error role="alert" hidden></p><div class="dialog-footer">${record ? `<button type="button" class="button delete-record" data-delete-kind="${kind}" data-delete-id="${escapeHTML(id)}">Delete ${kind}</button>` : ''}<button type="button" class="button secondary" data-close>Cancel</button><button type="submit" class="button">${record ? 'Save changes' : kind==='note' ? 'Save note' : `Create ${kind}`}</button></div></form>`);
  }
  function confirmDialog(title,copy,label,callback,danger=false) {openDialog(title,`<div class="confirm-copy">${copy}</div><p class="form-error" data-confirm-error role="alert" hidden></p><div class="dialog-footer"><button type="button" class="button secondary" data-close>Cancel</button><button type="button" class="button${danger ? ' danger' : ''}" data-confirm>${label}</button></div>`);const button=dialog.querySelector('[data-confirm]');button.addEventListener('click',async()=>{button.disabled=true;try{if(await callback() !== false)closeDialog();else dialogError(lastSaveError || 'This action could not be saved. Please try again.');}catch(error){dialogError(error.message || 'The action could not be completed.');}finally{button.disabled=false;}});}
  function download(text,filename) {const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportBackup() {download(exportWorkspace(data),`velita-workspace-${today()}.json`);notify('Backup exported. Keep it somewhere safe.');}
  async function selectImport() {
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);
    input.addEventListener('cancel',()=>input.remove(),{once:true});
    input.addEventListener('change',async()=>{const file=input.files?.[0];input.remove();if(!file)return;try{if(file.size>MAX_BACKUP_LENGTH*4)throw new Error('This backup is too large to open.');const incoming=parseBackup(await file.text());confirmDialog('Replace this workspace?',`<p>This backup contains <strong>${incoming.projects.length} projects, ${incoming.tasks.length} tasks and ${incoming.notes.length} notes</strong>.</p><p>It will replace the saved workspace for this account in this browser. Export your current data first if you want to keep it.</p>`,'Import and replace',async()=>{if(await commit(incoming,'Backup imported.',true)){externalPending=false;view='overview';render(true);return true;}return false;},true);}catch(error){notify(error.message || 'This file is not a valid Velita backup.',true);}},{once:true});input.click();
  }
  function showStorageError(error) {
    data=null;status('Storage needs attention');root.innerHTML=`<section class="surface storage-error"><h1 id="viewTitle">Your data needs attention.</h1><p>${escapeHTML(error.message || 'This browser could not load the saved workspace.')}</p><p>Nothing has been overwritten. Download the stored data for safekeeping, import a valid backup, or explicitly start again.</p><div class="header-actions">${actionButton('recover-export','Download stored data')}${actionButton('import','Import backup',true)}${actionButton('clear','Start an empty workspace',true)}</div></section>`;
  }
  async function onClick(event) {
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.view){showView(button.dataset.view);return;}
    const action=button.dataset.action,id=button.dataset.id;if(!action)return;
    if(action==='import'){selectImport();return;}
    if(action==='recover-export'){try{const raw=storage.getItem(store.key);if(!raw)throw new Error('No stored data is available.');download(raw,`velita-recovery-${today()}.json`);}catch(error){notify(error.message,true);}return;}
    if(action==='clear'){confirmDialog('Clear this workspace?','<p>This removes this account’s saved workspace from this browser. It does not change your login or another account’s data.</p><p>There is no undo without an exported backup.</p>','Clear workspace',async()=>{if(await commit(createEmptyWorkspace(),'Workspace cleared.',true)){externalPending=false;view='overview';render(true);return true;}return false;},true);return;}
    if(!data)return;
    if(action==='export'){exportBackup();return;}
    if(action==='open-project'){detailId=id;view='project';search='';render(true);return;}
    if(action==='archive-project'){const project=getProject(id);if(project){button.disabled=true;await commit(updateRecord(data,'project',id,{archived:!project.archived}),project.archived ? 'Project restored.' : 'Project archived.');button.disabled=false;}return;}
    if(action.startsWith('new-'))recordDialog(action.slice(4),'',button.dataset.project || '');
    if(action.startsWith('edit-'))recordDialog(action.slice(5),id);
  }
  root.addEventListener('click',onClick,{signal});nav?.addEventListener('click',onClick,{signal});
  root.addEventListener('input',event=>{if(event.target.matches('[data-search]')){search=event.target.value;refreshResults();}},{signal});
  root.addEventListener('change',async event=>{const target=event.target;const filter=target.dataset.filter;if(filter){if(filter==='stage')stageFilter=target.value;if(filter==='status')statusFilter=target.value;if(filter==='project')projectFilter=target.value;if(filter==='archived')showArchived=target.checked;refreshResults();}if(target.dataset.taskToggle){const task=data.tasks.find(item=>item.id===target.dataset.taskToggle);if(task){target.disabled=true;if(!await commit(updateRecord(data,'task',task.id,{status:target.checked ? 'Done' : 'To do'}),'Task updated.'))render();}}if(target.dataset.taskStatus){target.disabled=true;if(!await commit(updateRecord(data,'task',target.dataset.taskStatus,{status:target.value}),'Task updated.'))render();}},{signal});
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-close]'))closeDialog();const remove=event.target.closest('[data-delete-kind]');if(remove){const {deleteKind:kind,deleteId:id}=remove.dataset;confirmDialog(`Delete this ${kind}?`,kind==='project' ? '<p>The project will be permanently removed. Its tasks and notes will be kept, without a project.</p>' : `<p>This ${kind} will be permanently removed from this workspace. There is no undo without a backup.</p>`,`Delete ${kind}`,async()=>{const next=deleteRecord(data,kind,id);if(await commit(next,`${kind[0].toUpperCase()+kind.slice(1)} deleted.`)){if(kind==='project'&&detailId===id){view='projects';detailId='';render(true);}return true;}return false;},true);}},{signal});
  dialog.addEventListener('submit',async event=>{const form=event.target;if(!form.matches('[data-record-form]'))return;event.preventDefault();const fields=Object.fromEntries(new FormData(form));const errorBox=form.querySelector('[data-form-error]');const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;try{const next=form.dataset.id ? updateRecord(data,form.dataset.kind,form.dataset.id,fields) : createRecord(data,form.dataset.kind,fields);if(await commit(next,form.dataset.id ? 'Changes saved.' : `${form.dataset.kind[0].toUpperCase()+form.dataset.kind.slice(1)} created.`))closeDialog();else{errorBox.textContent=lastSaveError || 'Your changes were not saved. Please try again.';errorBox.hidden=false;}}catch(error){errorBox.textContent=error.message;errorBox.hidden=false;}finally{submit.disabled=false;}},{signal});
  dialog.addEventListener('close',()=>{if(dialog.open)return;if(externalPending){externalPending=false;try{data=store.load();render();status('Saved on this device');}catch(error){showStorageError(error);}}if(!document.activeElement||document.activeElement===document.body)root.querySelector('#viewTitle')?.focus({preventScroll:true});},{signal});
  window.addEventListener('storage',event=>{if(event.key!==storageEventKey&&event.key!==null)return;if(dialog.open){externalPending=true;dialogError('Workspace updated in another tab. Close this editor and reopen it before saving.');notify('Workspace updated in another tab. Close this editor before making more changes.',true);return;}try{data=store.load();render();status('Updated from another tab');}catch(error){showStorageError(error);}},{signal});
  try{data=store.load();render(true);status('Saved on this device');}catch(error){showStorageError(error);}
  const instance={destroy(){data=null;controller.abort();clearTimeout(toastTimer);dialog.remove();toast.remove();root.replaceChildren();mounted.delete(root);}};
  mounted.set(root,instance);return instance;
}
