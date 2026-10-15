import {getApp} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {getAuth, onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {mountWorkspace} from './workspace.mjs';

// The existing inline Firebase module owns initialization, sign-in guards and
// sign-out. This module only attaches workspace data to the verified account.
const root = document.getElementById('workspaceRoot');
let workspace;
onAuthStateChanged(getAuth(getApp()), user => {
  workspace?.destroy();
  workspace = undefined;
  if (!user) return;
  try {
    workspace = mountWorkspace(root, {uid: user.uid, email: user.email || ''});
  } catch {
    root.replaceChildren();
    const message = document.createElement('p');
    message.textContent = 'The workspace could not open. Check browser storage permissions and reload. Nothing has been overwritten.';
    message.setAttribute('role','alert');
    root.append(message);
  }
});
