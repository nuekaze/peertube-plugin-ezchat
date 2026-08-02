function mountEmoteManager(rootEl, peertubeHelpers) {
    const baseRoute = peertubeHelpers.getBaseRouterRoute().replace(/\/+$/, '');
    const apiBase = baseRoute + '/admin/emotes';
    const imageBase = baseRoute;

    rootEl.innerHTML = `
        <div class="ezchat-emote-manager">
            <h1>EZChat Emote Manager</h1>
            <div class="ezchat-emote-manager-messages"></div>
            <h2>Upload Emotes</h2>
            <div class="ezchat-emote-manager-drop-zone">
                <strong>Drop image files here</strong>
                <span>or</span>
                <button type="button" class="btn btn-primary ezchat-emote-manager-choose">Choose files</button>
                <button type="button" class="btn ezchat-emote-manager-upload" disabled>Upload files</button>
                <small>PNG, GIF, or WebP. Maximum 1 MB per file.</small>
            </div>
            <input type="file" class="ezchat-emote-manager-file-input" multiple accept=".png,.gif,.webp" hidden />
            <div class="ezchat-emote-manager-file-status" aria-live="polite"></div>
            <h2>Emotes</h2>
            <form class="ezchat-emote-manager-form">
                <table>
                    <thead><tr><th>Preview</th><th>Code Name</th><th>Action</th></tr></thead>
                    <tbody class="ezchat-emote-manager-table"></tbody>
                </table>
                <button type="submit" class="btn btn-primary">Save Emotes</button>
            </form>
        </div>`;

    const messages = rootEl.querySelector('.ezchat-emote-manager-messages');
    const dropZone = rootEl.querySelector('.ezchat-emote-manager-drop-zone');
    const chooseButton = rootEl.querySelector('.ezchat-emote-manager-choose');
    const uploadButton = rootEl.querySelector('.ezchat-emote-manager-upload');
    const fileInput = rootEl.querySelector('.ezchat-emote-manager-file-input');
    const fileStatus = rootEl.querySelector('.ezchat-emote-manager-file-status');
    const form = rootEl.querySelector('.ezchat-emote-manager-form');
    const tbody = rootEl.querySelector('.ezchat-emote-manager-table');
    let pendingFiles = [];

    function headers() {
        return peertubeHelpers.getAuthHeader() || {};
    }

    function showMessage(text, type) {
        messages.textContent = text;
        messages.className = 'ezchat-emote-manager-messages ' + type;
    }

    function selectFiles(files) {
        if (!files.length) return;
        pendingFiles = Array.from(files);
        fileStatus.textContent = pendingFiles.length + ' file(s) selected. Click Upload files.';
        uploadButton.disabled = false;
    }

    function imageUrl(filename) {
        return imageBase + '/emotes/' + encodeURIComponent(filename);
    }

    function renderRows(emotes) {
        tbody.innerHTML = '';
        Object.entries(emotes).forEach(([code, filename]) => {
            const row = document.createElement('tr');
            row.innerHTML = '<td><img style="height:32px;width:32px;object-fit:contain" /></td>' +
                '<td><input type="text" class="form-control emote-code" /></td>' +
                '<td><button type="button" class="btn delete-emote">Delete</button></td>';
            row.querySelector('img').src = imageUrl(filename);
            row.querySelector('.emote-code').value = code;
            row.querySelector('.emote-code').dataset.filename = filename;
            row.querySelector('.delete-emote').dataset.filename = filename;
            tbody.appendChild(row);
        });
        if (!tbody.children.length) {
            tbody.innerHTML = '<tr><td colspan="3">No emotes yet. Upload some above.</td></tr>';
        }
    }

    async function loadEmotes() {
        const response = await fetch(apiBase, { headers: headers() });
        if (!response.ok) throw new Error('Failed to load emotes (' + response.status + ').');
        const data = await response.json();
        renderRows(data.emotes || {});
    }

    async function uploadFiles() {
        if (!pendingFiles.length) return;
        const formData = new FormData();
        pendingFiles.forEach(file => formData.append('emotes', file));
        const response = await fetch(apiBase + '/upload', {
            method: 'POST',
            headers: headers(),
            body: formData
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'Upload failed.');
        data.files.forEach(file => {
            const row = document.createElement('tr');
            row.innerHTML = '<td><img style="height:32px;width:32px;object-fit:contain" /></td>' +
                '<td><input type="text" class="form-control emote-code" /></td>' +
                '<td><button type="button" class="btn delete-emote">Delete</button></td>';
            row.querySelector('img').src = imageUrl(file.filename);
            row.querySelector('.emote-code').value = file.name;
            row.querySelector('.emote-code').dataset.filename = file.filename;
            row.querySelector('.delete-emote').dataset.filename = file.filename;
            const placeholder = tbody.querySelector('td[colspan]');
            if (placeholder) tbody.innerHTML = '';
            tbody.appendChild(row);
        });
        showMessage('Uploaded ' + data.files.length + ' file(s). Assign names and click Save.', 'success');
        pendingFiles = [];
        fileInput.value = '';
        uploadButton.disabled = true;
        fileStatus.textContent = '';
    }

    dropZone.addEventListener('click', () => fileInput.click());
    chooseButton.addEventListener('click', event => {
        event.stopPropagation();
        fileInput.click();
    });
    uploadButton.addEventListener('click', event => {
        event.stopPropagation();
        uploadFiles().catch(error => showMessage(error.message, 'error'));
    });
    dropZone.addEventListener('dragover', event => {
        event.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', event => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        selectFiles(event.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
        selectFiles(fileInput.files);
    });

    tbody.addEventListener('click', async event => {
        if (!event.target.classList.contains('delete-emote')) return;
        try {
            const filename = event.target.dataset.filename;
            const response = await fetch(apiBase + '/delete', {
                method: 'POST',
                headers: { ...headers(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename })
            });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || 'Delete failed.');
            event.target.closest('tr').remove();
            if (!tbody.querySelector('.emote-code')) renderRows({});
            showMessage('Emote deleted.', 'success');
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const emotes = [];
            tbody.querySelectorAll('.emote-code').forEach(input => {
                const code = input.value.trim();
                if (code) emotes.push({ code, filename: input.dataset.filename });
            });
            const response = await fetch(apiBase + '/save', {
                method: 'POST',
                headers: { ...headers(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ emotes })
            });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || 'Save failed.');
            showMessage('Emotes saved!', 'success');
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    loadEmotes().catch(error => showMessage(error.message, 'error'));
}

export { mountEmoteManager };
