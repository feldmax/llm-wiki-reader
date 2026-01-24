// Corporate Documentation AI Analyzer
// Main application logic

const app = {
    resources: [],
    contextData: '',
    visitedUrls: new Set(),
    processedSpaces: new Set(),

    init() {
        this.addResource();
    },

    // Parse Wiki URL to extract server and space name
    parseWikiUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');

            // Pattern: /wiki/spaces/<SpaceName>/pages/<page-id>/<page-name>
            const spacesIndex = pathParts.indexOf('spaces');
            if (spacesIndex !== -1 && pathParts[spacesIndex + 1]) {
                const spaceName = pathParts[spacesIndex + 1];
                const wikiServer = `${urlObj.protocol}//${urlObj.host}`;

                return {
                    wikiServer,
                    spaceName,
                    isValid: true
                };
            }

            return { isValid: false };
        } catch (error) {
            console.error('Error parsing URL:', error);
            return { isValid: false };
        }
    },

    // Fetch page content with credentials (SSO authentication)
    async fetchPageContent(url) {
        try {
            this.showStatus(`Fetching: ${url}`, 'info');

            // Use credentials: 'include' to send cookies/auth headers
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include', // Important for SSO authentication
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml',
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Remove non-content elements
            const elementsToRemove = doc.querySelectorAll('script, style, nav, header, footer, iframe, noscript');
            elementsToRemove.forEach(el => el.remove());

            // Extract text content
            const textContent = doc.body.innerText || doc.body.textContent;

            // Extract all links
            const links = Array.from(doc.querySelectorAll('a[href]'))
                .map(a => {
                    try {
                        return new URL(a.href, url).href;
                    } catch {
                        return null;
                    }
                })
                .filter(link => link && link.startsWith('http'));

            return {
                text: textContent.trim(),
                links: [...new Set(links)],
                success: true
            };
        } catch (error) {
            console.error(`Error fetching ${url}:`, error);
            this.showStatus(`Warning: Could not fetch ${url} - ${error.message}`, 'warning');
            return { text: '', links: [], success: false, error: error.message };
        }
    },

    // Get all pages from a Wiki space
    async getAllSpacePages(wikiServer, spaceName) {
        // In real Confluence/Atlassian Wiki, you would use the REST API
        // For now, we'll crawl from the initial page and collect same-space pages
        const spacePages = new Set();
        const spacePrefix = `${wikiServer}/wiki/spaces/${spaceName}/`;

        return spacePages;
    },

    // Crawl Wiki space and linked pages
    async crawlWikiSpace(initialUrl) {
        const parseResult = this.parseWikiUrl(initialUrl);

        if (!parseResult.isValid) {
            throw new Error('Invalid Wiki URL format. Expected: https://<server>/wiki/spaces/<space>/pages/...');
        }

        const { wikiServer, spaceName } = parseResult;
        const spaceKey = `${wikiServer}::${spaceName}`;

        if (this.processedSpaces.has(spaceKey)) {
            this.showStatus(`Space ${spaceName} already processed, skipping...`, 'info');
            return '';
        }

        this.processedSpaces.add(spaceKey);

        let contextContent = `\n\n${'='.repeat(80)}\n`;
        contextContent += `WIKI SPACE: ${spaceName}\n`;
        contextContent += `Server: ${wikiServer}\n`;
        contextContent += `${'='.repeat(80)}\n\n`;

        // Collect all pages in the space
        const spacePrefix = `${wikiServer}/wiki/spaces/${spaceName}/`;
        const pagesToVisit = [initialUrl];
        const spacePages = new Set([initialUrl]);
        const externalLinks = new Set();
        const otherSpaceLinks = new Set();

        // Phase 1: Collect all pages in the current space
        this.showStatus(`Phase 1: Collecting all pages from space "${spaceName}"...`, 'info');

        while (pagesToVisit.length > 0) {
            const currentUrl = pagesToVisit.shift();

            if (this.visitedUrls.has(currentUrl)) {
                continue;
            }

            this.visitedUrls.add(currentUrl);
            const { text, links, success } = await this.fetchPageContent(currentUrl);

            if (success && text) {
                contextContent += `\n--- PAGE: ${currentUrl} ---\n\n`;
                contextContent += text + '\n';
            }

            // Categorize links
            links.forEach(link => {
                if (link.startsWith(spacePrefix)) {
                    // Same space link
                    if (!spacePages.has(link) && !this.visitedUrls.has(link)) {
                        spacePages.add(link);
                        pagesToVisit.push(link);
                    }
                } else if (link.includes('/wiki/spaces/')) {
                    // Different space on same wiki server
                    const linkParse = this.parseWikiUrl(link);
                    if (linkParse.isValid && linkParse.wikiServer === wikiServer) {
                        otherSpaceLinks.add(link);
                    } else {
                        externalLinks.add(link);
                    }
                } else if (link.startsWith('http')) {
                    // External link
                    externalLinks.add(link);
                }
            });

            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Phase 2: Fetch pages from other spaces on the same wiki (depth 1)
        this.showStatus(`Phase 2: Fetching linked pages from other spaces (${otherSpaceLinks.size} found)...`, 'info');

        for (const link of Array.from(otherSpaceLinks).slice(0, 20)) { // Limit to 20
            if (!this.visitedUrls.has(link)) {
                this.visitedUrls.add(link);
                const { text, success } = await this.fetchPageContent(link);

                if (success && text) {
                    contextContent += `\n--- LINKED PAGE (Other Space): ${link} ---\n\n`;
                    contextContent += text + '\n';
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Phase 3: Fetch external pages (depth 1)
        this.showStatus(`Phase 3: Fetching external linked pages (${externalLinks.size} found)...`, 'info');

        for (const link of Array.from(externalLinks).slice(0, 10)) { // Limit to 10
            if (!this.visitedUrls.has(link)) {
                this.visitedUrls.add(link);
                const { text, success } = await this.fetchPageContent(link);

                if (success && text) {
                    contextContent += `\n--- EXTERNAL LINKED PAGE: ${link} ---\n\n`;
                    contextContent += text + '\n';
                }

                await new Promise(resolve => setTimeout(resolve, 150));
            }
        }

        return contextContent;
    },

    // Collect context from all resources
    async collectContext() {
        const validResources = this.resources.filter(r => r.url.trim() !== '');

        if (validResources.length === 0) {
            throw new Error('Please add at least one valid Wiki URL');
        }

        this.visitedUrls.clear();
        this.processedSpaces.clear();

        let fullContext = '=== CORPORATE DOCUMENTATION CONTEXT ===\n';
        fullContext += `Generated: ${new Date().toISOString()}\n`;
        fullContext += `Total Resources: ${validResources.length}\n`;
        fullContext += `User: ${navigator.userAgent}\n\n`;

        for (const resource of validResources) {
            try {
                this.showStatus(`Processing Wiki URL: ${resource.url}`, 'info');
                const content = await this.crawlWikiSpace(resource.url);
                fullContext += content;
            } catch (error) {
                fullContext += `\n\nERROR processing ${resource.url}: ${error.message}\n\n`;
                this.showStatus(`Error processing ${resource.url}: ${error.message}`, 'error');
            }
        }

        fullContext += `\n\n${'='.repeat(80)}\n`;
        fullContext += `Total pages processed: ${this.visitedUrls.size}\n`;
        fullContext += `${'='.repeat(80)}\n`;

        return fullContext;
    },

    // Resource management
    addResource() {
        const id = Date.now();
        this.resources.push({ id, url: '' });
        this.renderResources();
    },

    removeResource(id) {
        this.resources = this.resources.filter(r => r.id !== id);
        this.renderResources();
        if (this.resources.length === 0) {
            this.addResource();
        }
    },

    updateResource(id, url) {
        const resource = this.resources.find(r => r.id === id);
        if (resource) {
            resource.url = url;
        }
    },

    renderResources() {
        const container = document.getElementById('resources-container');
        container.innerHTML = this.resources.map((resource, index) => `
            <div class="resource-item">
                <div class="resource-header">
                    <span class="resource-label">Wiki Page URL ${index + 1}</span>
                    ${this.resources.length > 1 ?
                        `<button class="btn btn-secondary btn-small" onclick="app.removeResource(${resource.id})">Remove</button>`
                        : ''}
                </div>
                <input
                    type="url"
                    placeholder="https://wiki.one.int.sap/wiki/spaces/maxf/pages/..."
                    value="${resource.url}"
                    onchange="app.updateResource(${resource.id}, this.value)"
                />
            </div>
        `).join('');
    },

    // UI helpers
    showStatus(message, type = 'info') {
        const container = document.getElementById('status-container');
        container.innerHTML = `<div class="status ${type}">${message}</div>`;
    },

    clearStatus() {
        document.getElementById('status-container').innerHTML = '';
    },

    addMessageToChat(role, content, contextFile = null) {
        const chatArea = document.getElementById('chat-area');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        let html = `<div class="message-label">${role === 'user' ? 'You' : 'Assistant'}</div>`;
        html += `<div>${content.replace(/\n/g, '<br>')}</div>`;

        if (contextFile) {
            const blob = new Blob([contextFile], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const filename = `wiki_context_${new Date().toISOString().split('T')[0]}.txt`;
            html += `<a href="${url}" download="${filename}" class="download-link">📎 Download Context File (${Math.round(contextFile.length / 1024)} KB)</a>`;
        }

        messageDiv.innerHTML = html;
        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    },

    // Main send query function
    async sendQuery() {
        const query = document.getElementById('user-query').value.trim();
        const llmSelect = document.getElementById('llm-select').value;

        if (!query) {
            this.showStatus('Please enter a question', 'error');
            return;
        }

        this.clearStatus();
        this.addMessageToChat('user', query);

        try {
            this.showStatus('Collecting Wiki documentation context...', 'info');
            this.contextData = await this.collectContext();

            this.showStatus('Context collected! Preparing LLM prompt...', 'success');

            // Prepare the full prompt
            const fullPrompt = `Based on the following corporate Wiki documentation context, please answer this question:\n\n${query}\n\n--- WIKI CONTEXT ---\n${this.contextData}`;

            // LLM URLs
            const llmUrls = {
                'claude': 'https://claude.ai/new',
                'gemini': 'https://gemini.google.com',
                'chatgpt': 'https://chatgpt.com',
                'grok': 'https://grok.com',
                'corporate': 'https://sapit-core-playground-vole.ai-launchpad.prod.eu-central-1.aws.apps.ml.hana.ondemand.com/aic/index.html#/generativeaihub?workspace=sap-genai-xl&resourceGroup=default&/g/promptchat'
            };

            // Copy to clipboard
            await navigator.clipboard.writeText(fullPrompt);

            const stats = `✅ Context collected successfully!\n\n` +
                `📊 Statistics:\n` +
                `  • Total pages processed: ${this.visitedUrls.size}\n` +
                `  • Total spaces: ${this.processedSpaces.size}\n` +
                `  • Context size: ${Math.round(this.contextData.length / 1024)} KB\n\n` +
                `📋 The full prompt has been copied to your clipboard.\n\n` +
                `🚀 Opening ${llmSelect} in a new tab. Please paste the prompt there.\n\n` +
                `💾 You can also download the context file below.`;

            this.addMessageToChat('assistant', stats, this.contextData);

            window.open(llmUrls[llmSelect], '_blank');
            this.clearStatus();

        } catch (error) {
            this.showStatus(`Error: ${error.message}`, 'error');
            this.addMessageToChat('assistant', `❌ Error: ${error.message}`);
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
