        const BASE_URL = `https://lylanoble.github.io/phone_lookup/npi_ndjson/`;
        const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const RESULTS_PER_PAGE = 100;

        // Cache config
        const DB_NAME = 'npi_cache';
        const DB_VERSION = 1;
        const STORE_NAME = 'files';
        const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

        const phoneInput = document.getElementById('phoneInput');
        const resultsArea = document.getElementById('resultsArea');
        const statusBar = document.getElementById('statusBar');
        const statusText = document.getElementById('statusText');
        const execSearch = document.getElementById('execSearch');
        const stopBtn = document.getElementById('stopBtn');

        const monthPickerBtn = document.getElementById('monthPickerBtn');
        const monthPickerDropdown = document.getElementById('monthPickerDropdown');
        const selectedMonthText = document.getElementById('selectedMonthText');
        const monthPickerChevron = document.getElementById('monthPickerChevron');
        const currentYearElem = document.getElementById('currentYear');
        const monthsGrid = document.getElementById('monthsGrid');
        const prevYearBtn = document.getElementById('prevYear');
        const nextYearBtn = document.getElementById('nextYear');

        const paginationTop = document.getElementById('paginationTop');
        const paginationBottom = document.getElementById('paginationBottom');
        const rangeStart = document.getElementById('rangeStart');
        const rangeEnd = document.getElementById('rangeEnd');
        const totalResults = document.getElementById('totalResults');
        const currentPageNum = document.getElementById('currentPageNum');
        const currentPageNum2 = document.getElementById('currentPageNum2');
        const totalPagesElem = document.getElementById('totalPages');
        const totalPagesElem2 = document.getElementById('totalPages2');

        const firstBtn = document.getElementById('firstBtn');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const lastBtn = document.getElementById('lastBtn');
        const firstBtn2 = document.getElementById('firstBtn2');
        const prevBtn2 = document.getElementById('prevBtn2');
        const nextBtn2 = document.getElementById('nextBtn2');
        const lastBtn2 = document.getElementById('lastBtn2');

        const themeToggle = document.getElementById('themeToggle');
        const themeIcon = document.getElementById('themeIcon');
        const cacheProgressContainer = document.getElementById('cacheProgressContainer');
        const cacheProgressBar = document.getElementById('cacheProgressBar');
        const cacheProgressText = document.getElementById('cacheProgressText');

        let isSearching = false;
        let activeCard = null;
        let allResults = [];
        let currentPage = 1;
        let totalPages = 1;
        let selectedMonth = null;
        let displayYear = new Date().getFullYear();
        let availableMonths = new Set();

        // In-memory cache (populated from IndexedDB or network)
        const memoryCache = new Map();

        // ─────────────────────────────────────────────
        // IndexedDB helpers
        // ─────────────────────────────────────────────
        let db = null;

        function openDB() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = e => {
                    const d = e.target.result;
                    if (!d.objectStoreNames.contains(STORE_NAME)) {
                        d.createObjectStore(STORE_NAME, { keyPath: 'fileName' });
                    }
                };
                req.onsuccess = e => resolve(e.target.result);
                req.onerror = e => reject(e.target.error);
            });
        }

        async function idbGet(fileName) {
            try {
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readonly');
                    const req = tx.objectStore(STORE_NAME).get(fileName);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
            } catch { return null; }
        }

        async function idbSet(fileName, data) {
            try {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    tx.objectStore(STORE_NAME).put({ fileName, data, cachedAt: Date.now() });
                    tx.oncomplete = resolve;
                    tx.onerror = reject;
                });
            } catch(e) { console.warn('IDB write failed', e); }
        }

        function isCacheStale(cachedAt) {
            return (Date.now() - cachedAt) > CACHE_TTL_MS;
        }

        // ─────────────────────────────────────────────
        // Fetch + cache a single file (network → IDB → memory)
        // ─────────────────────────────────────────────
        async function fetchAndCache(fileName) {
            // 1. Already in memory?
            if (memoryCache.has(fileName)) return memoryCache.get(fileName);

            // 2. Check IndexedDB
            if (db) {
                const cached = await idbGet(fileName);
                if (cached && !isCacheStale(cached.cachedAt)) {
                    memoryCache.set(fileName, cached.data);
                    return cached.data;
                }
            }

            // 3. Fetch from network
            try {
                const res = await fetch(`${BASE_URL}${fileName}.ndjson`);
                if (!res.ok) return null;
                const text = await res.text();
                const data = text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

                // Store in memory + IDB
                memoryCache.set(fileName, data);
                if (db) idbSet(fileName, data); // fire-and-forget

                return data;
            } catch(e) {
                console.warn('Fetch failed for', fileName, e);
                return null;
            }
        }

        // ─────────────────────────────────────────────
        // Background prefetch — runs quietly on load
        // ─────────────────────────────────────────────
        async function prefetchAll() {
            const fileNames = Array.from(availableMonths);
            let done = 0;

            cacheProgressContainer.classList.remove('hidden');

            for (const fileName of fileNames) {
                // Don't block if user is actively searching
                if (isSearching) {
                    await new Promise(r => setTimeout(r, 500));
                }

                // Skip if already in memory
                if (!memoryCache.has(fileName)) {
                    // Check IDB first (cheap), only network-fetch if missing/stale
                    let needsNetwork = true;
                    if (db) {
                        const cached = await idbGet(fileName);
                        if (cached && !isCacheStale(cached.cachedAt)) {
                            memoryCache.set(fileName, cached.data);
                            needsNetwork = false;
                            markMonthCached(fileName);
                        }
                    }

                    if (needsNetwork) {
                        await fetchAndCache(fileName);
                        markMonthCached(fileName);
                    }
                }

                done++;
                const pct = Math.round((done / fileNames.length) * 100);
                cacheProgressBar.style.width = pct + '%';
                cacheProgressText.textContent = pct + '%';

                // Small yield to keep UI responsive
                await new Promise(r => setTimeout(r, 30));
            }

            // Hide progress bar when done
            setTimeout(() => {
                cacheProgressContainer.style.opacity = '0';
                cacheProgressContainer.style.transition = 'opacity 0.5s ease';
                setTimeout(() => cacheProgressContainer.classList.add('hidden'), 600);
            }, 1500);
        }

        function markMonthCached(fileName) {
            // Find the button in the month grid and add the cached style
            const btn = monthsGrid.querySelector(`[data-file-name="${fileName}"]`);
            if (btn) btn.classList.add('cached');
        }

        // ─────────────────────────────────────────────
        // Theme Management
        // ─────────────────────────────────────────────
        function initTheme() {
            const savedTheme = localStorage.getItem('theme') || 'dark';
            setTheme(savedTheme);
        }

        function setTheme(theme) {
            if (theme === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
                themeToggle.classList.add('active');
                themeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />';
            } else {
                document.documentElement.removeAttribute('data-theme');
                themeToggle.classList.remove('active');
                themeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />';
            }
            localStorage.setItem('theme', theme);
        }

        function toggleTheme() {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            setTheme(newTheme);
        }

        themeToggle.addEventListener('click', toggleTheme);

        // ─────────────────────────────────────────────
        // Month Picker
        // ─────────────────────────────────────────────
        function initMonthPicker() {
            let d = new Date();
            for (let i = 0; i < 240; i++) {
                let monthIdx = d.getMonth();
                let year = d.getFullYear();
                let fileName = `${MONTHS[monthIdx]}_${year}`;
                availableMonths.add(fileName);
                d.setMonth(d.getMonth() - 1);
            }
            displayYear = new Date().getFullYear();
            renderMonthsGrid();
        }

        function renderMonthsGrid() {
            currentYearElem.textContent = displayYear;
            monthsGrid.innerHTML = '';

            MONTHS.forEach((month, idx) => {
                const fileName = `${month}_${displayYear}`;
                const isAvailable = availableMonths.has(fileName);
                const isCached = memoryCache.has(fileName);

                const monthBtn = document.createElement('button');
                monthBtn.className = `month-card px-4 py-3 rounded-xl border font-semibold text-xs uppercase transition-all ${
                    isAvailable
                        ? 'hover:bg-indigo-500/10 hover:border-indigo-500/30 cursor-pointer'
                        : 'cursor-not-allowed opacity-40'
                } ${isCached ? 'cached' : ''}`;
                monthBtn.style.cssText = isAvailable
                    ? `border-color: var(--border-color); background: var(--input-bg); color: var(--text-secondary);`
                    : `border-color: var(--border-color); background: rgba(0,0,0,0.1); color: var(--text-tertiary);`;
                monthBtn.textContent = month.toUpperCase();
                monthBtn.disabled = !isAvailable;

                if (isAvailable) {
                    monthBtn.dataset.fileName = fileName;
                    monthBtn.dataset.displayName = `${MONTH_NAMES[idx]} ${displayYear}`;
                    monthBtn.addEventListener('click', () => selectMonth(fileName, `${MONTH_NAMES[idx]} ${displayYear}`));
                }

                monthsGrid.appendChild(monthBtn);
            });
        }

        function navigateYear(direction) {
            displayYear += direction;
            renderMonthsGrid();
        }

        prevYearBtn.addEventListener('click', () => navigateYear(-1));
        nextYearBtn.addEventListener('click', () => navigateYear(1));

        function toggleMonthPicker() {
            const isHidden = monthPickerDropdown.classList.contains('hidden');
            monthPickerDropdown.classList.toggle('hidden', !isHidden);
            monthPickerChevron.classList.toggle('rotate-180', isHidden);
        }

        function selectMonth(fileName, displayName) {
            selectedMonth = fileName;
            selectedMonthText.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <span style="color: var(--text-primary);">${displayName}</span>
            `;
            monthPickerDropdown.classList.add('hidden');
            monthPickerChevron.classList.remove('rotate-180');
            loadDate(fileName);
        }

        document.addEventListener('click', (e) => {
            if (!monthPickerBtn.contains(e.target) && !monthPickerDropdown.contains(e.target)) {
                monthPickerDropdown.classList.add('hidden');
                monthPickerChevron.classList.remove('rotate-180');
            }
        });

        monthPickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMonthPicker();
        });

        // ─────────────────────────────────────────────
        // UI Helpers
        // ─────────────────────────────────────────────
        function setStatus(msg, show = true, showLoader = true) {
            statusBar.classList.toggle('hidden', !show);
            statusBar.classList.toggle('flex', show);
            statusText.innerText = msg;
            const loader = statusBar.querySelector('.loader');
            const stopButton = document.getElementById('stopBtn');
            if (loader) loader.style.display = showLoader ? 'block' : 'none';
            if (stopButton) stopButton.style.display = showLoader ? 'block' : 'none';
        }

        function updatePaginationControls() {
            const start = (currentPage - 1) * RESULTS_PER_PAGE + 1;
            const end = Math.min(currentPage * RESULTS_PER_PAGE, allResults.length);

            rangeStart.textContent = allResults.length > 0 ? start : 0;
            rangeEnd.textContent = end;
            totalResults.textContent = allResults.length;
            currentPageNum.textContent = currentPage;
            currentPageNum2.textContent = currentPage;
            totalPagesElem.textContent = totalPages;
            totalPagesElem2.textContent = totalPages;

            const isFirstPage = currentPage === 1;
            const isLastPage = currentPage === totalPages;

            firstBtn.disabled = isFirstPage;
            prevBtn.disabled = isFirstPage;
            nextBtn.disabled = isLastPage;
            lastBtn.disabled = isLastPage;
            firstBtn2.disabled = isFirstPage;
            prevBtn2.disabled = isFirstPage;
            nextBtn2.disabled = isLastPage;
            lastBtn2.disabled = isLastPage;

            const showPagination = allResults.length > RESULTS_PER_PAGE;
            paginationTop.classList.toggle('hidden', !showPagination);
            paginationBottom.classList.toggle('hidden', !showPagination);
        }

        function renderCurrentPage() {
            resultsArea.innerHTML = "";
            const start = (currentPage - 1) * RESULTS_PER_PAGE;
            const end = Math.min(start + RESULTS_PER_PAGE, allResults.length);
            const pageResults = allResults.slice(start, end);

            pageResults.forEach(item => {
                const card = createCard(item.data, item.source);
                resultsArea.appendChild(card);
            });

            updatePaginationControls();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function setResults(data, source = "") {
            allResults = data.map(item => ({ data: item, source }));
            currentPage = 1;
            totalPages = Math.ceil(allResults.length / RESULTS_PER_PAGE);
            renderCurrentPage();
        }

        function addResults(data, source = "") {
            data.forEach(item => allResults.push({ data: item, source }));
            totalPages = Math.ceil(allResults.length / RESULTS_PER_PAGE);
            renderCurrentPage();
        }

        function goToPage(page) {
            currentPage = Math.max(1, Math.min(page, totalPages));
            renderCurrentPage();
        }

        // ─────────────────────────────────────────────
        // Load by Month (uses cache)
        // ─────────────────────────────────────────────
        async function loadDate(fileName) {
            if (!fileName) return;
            isSearching = false;
            phoneInput.value = "";
            allResults = [];
            setStatus(`Loading ${fileName.toUpperCase()}...`, true, true);

            try {
                const data = await fetchAndCache(fileName);
                if (!data) throw new Error('Not found');
                setResults(data);
                setStatus(`Showing ${data.length} records from ${fileName.toUpperCase()}`, true, false);
                setTimeout(() => setStatus('', false, false), 3000);
            } catch (e) {
                setStatus(`Error: Could not load ${fileName}`, true, false);
                setTimeout(() => setStatus('', false, false), 5000);
            }
        }

        // ─────────────────────────────────────────────
        // Global Search (uses cache — instant if prefetched)
        // ─────────────────────────────────────────────
        async function globalSearch() {
            const query = phoneInput.value.replace(/\D/g, '');
            if (query.length < 3) return alert("Enter at least 3 digits");

            isSearching = true;
            selectedMonth = null;
            selectedMonthText.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <span style="color: var(--text-tertiary);">Select Month...</span>
            `;
            allResults = [];
            currentPage = 1;
            resultsArea.innerHTML = "";
            paginationTop.classList.add('hidden');
            paginationBottom.classList.add('hidden');

            const fileNames = Array.from(availableMonths);

            for (let fileName of fileNames) {
                if (!isSearching) break;

                const cached = memoryCache.has(fileName);
                setStatus(
                    cached
                        ? `Searching ${fileName.toUpperCase()} (cached)...`
                        : `Fetching ${fileName.toUpperCase()}...`,
                    true, true
                );

                try {
                    const data = await fetchAndCache(fileName);
                    if (!data) continue;

                    const matches = data.filter(row =>
                        row[0].includes(query) ||
                        row[6].includes(query) ||
                        row[7].includes(query) ||
                        row[8].includes(query)
                    );

                    if (matches.length > 0) {
                        addResults(matches, fileName);
                        setStatus(`Found ${allResults.length} total results...`, true, true);
                    }

                    if (allResults.length > 0) {
                        setStatus(`Search complete. Found ${allResults.length} results.`, true, false);
                        isSearching = false;
                        setTimeout(() => setStatus('', false, false), 3000);
                        return;
                    }
                } catch (e) { console.warn("Skipping " + fileName); }
            }

            if (allResults.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'glass-effect p-12 rounded-3xl border border-dashed text-center';
                emptyDiv.style.cssText = 'background: var(--bg-card); border-color: var(--border-color); color: var(--text-tertiary);';
                emptyDiv.innerHTML = '<p class="text-sm font-medium">No matches found in any database files.</p>';
                resultsArea.innerHTML = '';
                resultsArea.appendChild(emptyDiv);
                setStatus("No matches found", true, false);
                setTimeout(() => setStatus('', false, false), 3000);
            }
            isSearching = false;
        }

        // ─────────────────────────────────────────────
        // Card Renderer (unchanged)
        // ─────────────────────────────────────────────
        function createCard(item, source = "") {
            const wrapper = document.createElement('div');
            wrapper.className = 'group relative transition-all duration-500 z-0';

            const glow = document.createElement('div');
            glow.className = 'absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-2xl blur opacity-0 group-hover:opacity-20 transition duration-700';

            const isIndividual = item[1] == '1';
            const providerIcon = isIndividual
                ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                   </svg>`
                : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6">
                    <path d="M3 21h18"/>
                    <path d="M5 21V7l8-4v18"/>
                    <path d="M19 21V11l-6-4"/>
                    <path d="M9 9v.01"/>
                    <path d="M9 12v.01"/>
                    <path d="M9 15v.01"/>
                    <path d="M9 18v.01"/>
                   </svg>`;

            const card = document.createElement('div');
            card.className = "glass-effect relative p-5 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 h-full";
            card.style.background = 'var(--bg-secondary)';
            card.innerHTML = `
                <div class="md:w-1/2 flex flex-col justify-between">
                    <div class="flex items-center gap-3 mb-3">
                        <span class="animate-float-hover flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner transition-colors hover:bg-indigo-500/20">
                            ${providerIcon}
                        </span>
                        <a href="https://npiregistry.cms.hhs.gov/provider-view/${item[0]}" target="_blank" onclick="event.stopPropagation()" class="npi-badge bg-indigo-500/10 hover:text-white hover:bg-indigo-600/30 hover:border-indigo-400/50 transition-all duration-300 text-[10px] font-black px-3 py-1.5 rounded-lg border border-indigo-500/20 tracking-widest uppercase flex items-center gap-2 group/npi" style="color: rgb(165 180 252); background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.2);">
                            <span style="color: rgb(165 180 252);">NPI ${item[0]}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="opacity-50 group-hover/npi:translate-x-0.5 group-hover/npi:-translate-y-0.5 transition-transform">
                                <path d="M7 7h10v10"/><path d="M7 17 17 7"/>
                            </svg>
                        </a>
                        ${source ? `<span class="text-[10px] font-bold uppercase tracking-wide" style="color: var(--text-tertiary);">• ${source}</span>` : ''}
                    </div>
                    <h3 class="font-black text-xl md:text-2xl uppercase leading-tight tracking-tight group-hover:text-indigo-400 transition-colors" style="color: var(--text-primary);">${item[2]}</h3>
                    <div class="flex flex-wrap gap-3 mt-3">
                        <div class="flex items-center gap-2 px-3 py-1.5 rounded-full" style="color: var(--text-tertiary); background: var(--input-bg); border: 1px solid var(--border-color);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-400 animate-pulse-icon">
                                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                                <circle cx="12" cy="10" r="3"/>
                            </svg>
                            <span class="text-xs font-semibold uppercase tracking-wide opacity-90">${item[5]}</span>
                        </div>
                        <div class="flex items-center gap-2 border-l pl-3" style="color: var(--text-tertiary); border-color: var(--border-color);">
                            <span class="text-[10px] font-bold uppercase tracking-tighter">${isIndividual ? 'Individual' : 'Organization'}</span>
                        </div>
                    </div>
                </div>
                <div class="w-full md:w-1/2 p-4 rounded-2xl flex flex-col justify-between backdrop-blur-sm" style="background: var(--input-bg); border: 1px solid var(--border-color);">
                    ${item[7] ? `
                    <a href="tel:${item[7].replace(/\D/g, '')}" class="phone-link flex justify-between items-center hover:opacity-80 transition-opacity group/phone">
                        <span class="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5" style="color: var(--text-tertiary);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-400"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            Practice
                        </span>
                        <span class="text-sm font-bold text-indigo-400 group-hover/phone:text-indigo-300 transition-colors underline decoration-indigo-500/30 underline-offset-4">${item[7]}</span>
                    </a>` : `
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-[10px] font-black uppercase tracking-wider" style="color: var(--text-tertiary);">Practice</span>
                        <span class="text-sm font-bold text-indigo-400">N/A</span>
                    </div>`}
                    <div class="h-[1px] w-full my-2" style="background: var(--border-color);"></div>
                    ${item[6] ? `
                    <a href="tel:${item[6].replace(/\D/g, '')}" class="phone-link flex justify-between items-center hover:opacity-80 transition-opacity group/phone">
                        <span class="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5" style="color: var(--text-tertiary);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-400"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            Mailing
                        </span>
                        <span class="text-sm font-bold text-indigo-400 group-hover/phone:text-indigo-300 transition-colors underline decoration-indigo-500/30 underline-offset-4">${item[6]}</span>
                    </a>` : `
                    <div class="flex justify-between items-center">
                        <span class="text-[10px] font-black uppercase tracking-wider" style="color: var(--text-tertiary);">Mailing</span>
                        <span class="text-sm font-bold text-indigo-400">N/A</span>
                    </div>`}
                    <div class="h-[1px] w-full my-2" style="background: var(--border-color);"></div>
                    ${item[8] ? `
                    <a href="tel:${item[8].replace(/\D/g, '')}" class="phone-link flex justify-between items-center hover:opacity-80 transition-opacity group/phone">
                        <span class="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5" style="color: var(--text-tertiary);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-400"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            Authorized
                        </span>
                        <span class="text-sm font-bold text-indigo-400 group-hover/phone:text-indigo-300 transition-colors underline decoration-indigo-500/30 underline-offset-4">${item[8]}</span>
                    </a>` : `
                    <div class="flex justify-between items-center">
                        <span class="text-[10px] font-black uppercase tracking-wider" style="color: var(--text-tertiary);">Authorized</span>
                        <span class="text-sm font-bold text-indigo-400">N/A</span>
                    </div>`}
                </div>
            `;

            wrapper.appendChild(glow);
            wrapper.appendChild(card);

            wrapper.addEventListener('click', () => {
                // Deactivate previous card
                if (activeCard && activeCard !== card) {
                    activeCard.style.removeProperty('border');
                    activeCard.style.removeProperty('box-shadow');
                    activeCard = null;
                }
                // Toggle current card
                const isNowActive = card !== activeCard;
                if (isNowActive) {
                    card.style.setProperty('border', '2px solid rgba(99,102,241,0.7)', 'important');
                    card.style.setProperty('box-shadow', '0 0 0 1px rgba(99,102,241,0.4)', 'important');
                    activeCard = card;
                } else {
                    card.style.removeProperty('border');
                    card.style.removeProperty('box-shadow');
                    activeCard = null;
                }
            });

            return wrapper;
        }

        // ─────────────────────────────────────────────
        // Pagination events
        // ─────────────────────────────────────────────
        firstBtn.addEventListener('click', () => goToPage(1));
        prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
        nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
        lastBtn.addEventListener('click', () => goToPage(totalPages));
        firstBtn2.addEventListener('click', () => goToPage(1));
        prevBtn2.addEventListener('click', () => goToPage(currentPage - 1));
        nextBtn2.addEventListener('click', () => goToPage(currentPage + 1));
        lastBtn2.addEventListener('click', () => goToPage(totalPages));

        execSearch.addEventListener('click', globalSearch);
        stopBtn.addEventListener('click', () => {
            isSearching = false;
            setStatus("Search cancelled.", true, false);
            setTimeout(() => setStatus('', false, false), 2000);
        });
        phoneInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') globalSearch(); });

        // ─────────────────────────────────────────────
        // Init
        // ─────────────────────────────────────────────
        async function init() {
            initTheme();
            initMonthPicker();

            // Open IndexedDB, then start background prefetch
            try {
                db = await openDB();
            } catch(e) {
                console.warn('IndexedDB unavailable, will use memory-only cache', e);
            }

            // Start prefetch after a short delay so the page renders first
            setTimeout(() => prefetchAll(), 1000);
        }

        init();