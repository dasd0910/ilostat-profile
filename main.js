// ILOSTAT Country Profile Generator

// ILOSTAT Country Profile Generator

const API = {
    base: '', // Relative path
    // Local metadata files (downloaded manually to avoid CORS issues)
    dic: (varName) => `${varName}.csv`,
    // Proxy the data requests through our local python server
    data: (areaCode) => `/proxy/https://rplumber.ilo.org/data/ref_area/?id=${areaCode}_A&format=.csv.gz`
};

// State
const state = {
    countries: [],
    indicators: [],
    classifications: {
        sex: {},      // mapping code to label
        classif1: {}  // mapping code to label
    },
    selectedCountries: new Set(), // Set of country codes
    selectedIndicators: new Set(),
    startYear: 2000, // Default start year
    countryDataCache: {}, // { code: data[] }
    isOffline: false,
    status: 'idle'
};

let db;
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ILOSTAT_Cache', 1);
        request.onerror = (e) => resolve(null); // Silent fail, just don't cache
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('countryData')) {
                db.createObjectStore('countryData', { keyPath: 'code' });
            }
        };
    });
}

async function saveToDB(code, data) {
    if (!db) return;
    try {
        const transaction = db.transaction(['countryData'], 'readwrite');
        const store = transaction.objectStore('countryData');
        store.put({ code, data, timestamp: Date.now() });
    } catch (e) { console.warn('DB Save Error', e); }
}

async function getFromDB(code) {
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction(['countryData'], 'readonly');
            const store = transaction.objectStore('countryData');
            const request = store.get(code);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
    });
}

const ILO_COLORS = [
    '#3A4D98', // ILO Blue (Chambray)
    '#E40046', // ILO Red (Social Justice)
    '#1E2DBE', // Persian Blue
    '#230050', // Dark Blue
    '#FA3C4B', // Light Red
    '#00A3A1', // Teal (Complimentary)
    '#FFC20E', // Yellow (Complimentary)
    '#5D6770', // Grey
];

// DOM Elements
const els = {
    countryTags: document.getElementById('country-tags'),
    countrySearch: document.getElementById('country-search'),
    countryList: document.getElementById('country-list'),

    indicatorList: document.getElementById('indicators-list'),
    indicatorSearch: document.getElementById('search-indicators'),
    btnSelectAllInd: document.getElementById('btn-select-all-ind'),
    btnClearInd: document.getElementById('btn-clear-ind'),

    yearSlider: document.getElementById('year-slider'),
    yearDisplay: document.getElementById('year-display'),

    generateBtn: document.getElementById('generate-btn'),
    statusMsg: document.getElementById('status-message'),
    chartsContainer: document.getElementById('charts-container'),
    reportTitle: document.getElementById('report-title'),
    reportMeta: document.getElementById('report-meta')
};

async function init() {
    updateStatus('Loading dictionaries...');
    try {
        const [countriesRaw, indicatorsRaw, sexRaw, classif1Raw] = await Promise.all([
            fetchCSV(API.dic('ref_area')),
            fetchCSV(API.dic('indicator')),
            fetchCSV(API.dic('sex')),
            fetchCSV(API.dic('classif1'))
        ]);

        // Map local CSV headers to our app's expected structure
        // Local 'ref_area.csv' has 'ref_area' and 'ref_area.label'
        state.countries = countriesRaw.map(c => ({
            Code: c.ref_area || c.Code, // Fallback
            Label: c['ref_area.label'] || c.Label
        })).filter(c => c.Code && c.Label)
            .sort((a, b) => a.Label.localeCompare(b.Label));

        // Local 'indicator.csv' has 'indicator' and 'indicator.label'
        state.indicators = indicatorsRaw.map(i => ({
            Code: i.indicator || i.Code,
            Label: i['indicator.label'] || i.Label
        })).filter(i => i.Code && i.Label)
            .sort((a, b) => a.Label.localeCompare(b.Label));

        // Build classification maps
        sexRaw.forEach(s => {
            const code = s.sex || s.Code;
            const label = s['sex.label'] || s.Label;
            if (code && label) state.classifications.sex[code] = label;
        });

        classif1Raw.forEach(c => {
            const code = c.classif1 || c.Code;
            const label = c['classif1.label'] || c.Label;
            if (code && label) state.classifications.classif1[code] = label;
        });

        // Initial Render
        renderCountryList(); // Populate the dropdown list
        renderIndicators();

        await initDB();
        setupEventListeners();

        updateStatus('Ready');
        els.generateBtn.disabled = true; // Disabled until selection
    } catch (err) {
        console.error(err);
        updateStatus('Error loading metadata. Please refresh.');
    }
}

function updateStatus(msg) {
    els.statusMsg.textContent = msg;
}

// Data Fetching Helper
function fetchCSV(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data),
            error: (err) => reject(err)
        });
    });
}

// Render Functions

/**
 * Renders the dropdown list for country search
 * Filtered by the search term
 */
function renderCountryList(filter = '') {
    els.countryList.innerHTML = '';
    const term = filter.toLowerCase();

    state.countries.forEach(country => {
        // Skip if already selected
        if (state.selectedCountries.has(country.Code)) return;

        // Check filter
        if (filter && !country.Label.toLowerCase().includes(term) && !country.Code.toLowerCase().includes(term)) {
            return;
        }

        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.textContent = country.Label;
        div.addEventListener('click', () => selectCountry(country));
        els.countryList.appendChild(div);
    });
}

function selectCountry(country) {
    state.selectedCountries.add(country.Code);

    // Add tag
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `${country.Label} <span class="remove">&times;</span>`;
    tag.querySelector('.remove').addEventListener('click', () => removeCountry(country.Code, tag));
    els.countryTags.appendChild(tag);

    // Reset search
    els.countrySearch.value = '';
    renderCountryList();
    els.countryList.classList.add('hidden');

    updateGenerateButton();
}

function removeCountry(code, tagElement) {
    state.selectedCountries.delete(code);
    tagElement.remove();
    renderCountryList(); // Re-add to list
    updateGenerateButton();
}

function renderIndicators(filter = '') {
    els.indicatorList.innerHTML = '';
    const term = filter.toLowerCase();

    // Group indicators
    const groups = {};
    const otherGroup = 'Other';

    state.indicators.forEach(ind => {
        // Simple heuristic for grouping
        let group = otherGroup;
        if (ind.Code.startsWith('SDG_')) group = 'SDG Indicators';
        else if (ind.Code.startsWith('EMP_')) group = 'Employment';
        else if (ind.Code.startsWith('UNE_')) group = 'Unemployment';
        else if (ind.Code.startsWith('LU_')) group = 'Labour Underutilization';
        else if (ind.Code.startsWith('EAP_')) group = 'Labour Force';
        else if (ind.Code.startsWith('POP_')) group = 'Population';
        else if (ind.Code.startsWith('MIG_')) group = 'Migration';
        else if (ind.Code.startsWith('WAG_')) group = 'Wages';
        else if (ind.Code.startsWith('HOW_')) group = 'Hours of Work';
        else if (ind.Code.startsWith('MST_')) group = 'Monthly Data';

        if (!groups[group]) groups[group] = [];
        groups[group].push(ind);
    });

    // Render groups
    const sortedGroups = Object.keys(groups).sort((a, b) => {
        if (a === otherGroup) return 1;
        if (b === otherGroup) return -1;
        return a.localeCompare(b);
    });

    sortedGroups.forEach(groupName => {
        const groupItems = groups[groupName].filter(ind => {
            return !term || ind.Label.toLowerCase().includes(term) || ind.Code.toLowerCase().includes(term);
        });

        if (groupItems.length === 0) return;

        // Create a wrapper for the group
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'indicator-group';

        const groupHeader = document.createElement('div');
        groupHeader.className = 'group-header';

        // Add a toggle icon
        const icon = document.createElement('span');
        icon.className = 'toggle-icon';
        icon.innerHTML = '▼';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = groupName;

        groupHeader.appendChild(icon);
        groupHeader.appendChild(titleSpan);

        // Container for items, controlled by header
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'group-items';

        // Toggle logic: Expand all if searching, else default collapsed unless it's the first group
        const isSearching = term.length > 0;
        if (isSearching) {
            itemsContainer.classList.add('expanded');
            groupHeader.classList.add('expanded');
        } else {
            // Collapse by default for cleaner UI
            icon.innerHTML = '▶';
        }

        groupHeader.addEventListener('click', () => {
            const isExpanded = itemsContainer.classList.toggle('expanded');
            groupHeader.classList.toggle('expanded', isExpanded);
            icon.innerHTML = isExpanded ? '▼' : '▶';
        });

        groupWrapper.appendChild(groupHeader);

        groupItems.forEach(ind => {
            const item = document.createElement('label');
            item.className = 'indicator-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = ind.Code;
            checkbox.checked = state.selectedIndicators.has(ind.Code);
            checkbox.addEventListener('change', (e) => toggleIndicator(ind, e.target.checked));

            const text = document.createElement('span');
            text.textContent = ind.Label;

            item.appendChild(checkbox);
            item.appendChild(text);
            itemsContainer.appendChild(item);
        });

        groupWrapper.appendChild(itemsContainer);
        els.indicatorList.appendChild(groupWrapper);
    });
}


// Interaction Handlers
function toggleIndicator(indicator, isChecked) {
    if (isChecked) {
        state.selectedIndicators.add(indicator.Code);
    } else {
        state.selectedIndicators.delete(indicator.Code);
    }
    updateGenerateButton();
}

function updateGenerateButton() {
    const hasCountry = state.selectedCountries.size > 0;
    const hasIndicators = state.selectedIndicators.size > 0;
    els.generateBtn.disabled = !(hasCountry && hasIndicators);
}

function setupEventListeners() {
    // Country Search
    els.countrySearch.addEventListener('focus', () => {
        els.countryList.classList.remove('hidden');
        renderCountryList(els.countrySearch.value);
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.multi-select-container')) {
            els.countryList.classList.add('hidden');
        }
    });

    els.countrySearch.addEventListener('input', (e) => {
        els.countryList.classList.remove('hidden');
        renderCountryList(e.target.value);
    });

    // Indicator Search
    els.indicatorSearch.addEventListener('input', (e) => {
        renderIndicators(e.target.value);
    });


    // Time Slider
    els.yearSlider.addEventListener('input', (e) => {
        state.startYear = parseInt(e.target.value);
        els.yearDisplay.textContent = `Since ${state.startYear}`;
    });

    // Refresh charts when slider changes (if data exists)
    els.yearSlider.addEventListener('change', () => {
        if (state.countryDataCache && Object.keys(state.countryDataCache).length > 0) {
            processAndRenderData();
        }
    });

    // Bulk Actions
    els.btnSelectAllInd.addEventListener('click', () => {
        const visibleItems = Array.from(els.indicatorList.querySelectorAll('.indicator-item:not(.hidden) input'));
        visibleItems.forEach(cb => {
            cb.checked = true;
            state.selectedIndicators.add(cb.value);
        });
        updateGenerateButton();
    });

    els.btnClearInd.addEventListener('click', () => {
        const checkboxes = els.indicatorList.querySelectorAll('input');
        checkboxes.forEach(cb => cb.checked = false);
        state.selectedIndicators.clear();
        updateGenerateButton();
    });

    // Generate Report
    els.generateBtn.addEventListener('click', generateReport);

    // Download CSV
    document.getElementById('download-data-btn').addEventListener('click', downloadCSV);
}

// ... existing code ...

async function generateReport() {
    if (state.selectedCountries.size === 0) return;

    const countries = Array.from(state.selectedCountries);
    updateStatus(`Fetching data for ${countries.join(', ')}...`);
    els.chartsContainer.innerHTML = '<div class="loading-state">Loading data for all selected countries...</div>';

    try {
        // Fetch data for all selected countries in parallel
        await Promise.all(countries.map(code => fetchAndCacheCountryData(code)));

        processAndRenderData();
        updateStatus('Report generated.');
        document.getElementById('download-data-btn').disabled = false; // Enable download button
    } catch (err) {
        console.error(err);
        updateStatus('Error fetching data. Check console.');
        els.chartsContainer.innerHTML = '<div class="error-state">Error loading data.</div>';
    }
}

// ... existing code ...

function downloadCSV() {
    const selectedCntryCodes = Array.from(state.selectedCountries);
    const selectedIndCodes = Array.from(state.selectedIndicators);

    // headers
    const rows = [['Country', 'Indicator', 'Year', 'Value', 'Unit', 'Status']];

    selectedCntryCodes.forEach(countryCode => {
        const countryData = state.countryDataCache[countryCode];
        if (!countryData) return;

        const countryLabel = state.countries.find(c => c.Code === countryCode)?.Label || countryCode;

        selectedIndCodes.forEach(indCode => {
            const indicatorMeta = state.indicators.find(i => i.Code === indCode);
            const indLabel = indicatorMeta ? indicatorMeta.Label : indCode;

            let indData = countryData.filter(d => d.indicator === indCode);

            // Time Filter
            indData = indData.filter(d => parseInt(d.time) >= state.startYear);

            // Same filtering logic as charts
            if (indData.length > 0) {
                if (indData[0].sex) indData = indData.filter(d => d.sex === 'SEX_T');
                if (indData.length > 0 && indData[0].classif1) {
                    const totals = indData.filter(d => d.classif1.includes('_TOTAL') || d.classif1.includes('_AGGREGATE_TOTAL'));
                    if (totals.length > 0) indData = totals;
                    else {
                        const firstClassif = indData[0].classif1;
                        indData = indData.filter(d => d.classif1 === firstClassif);
                    }
                }
            }

            indData.forEach(d => {
                rows.push([
                    `"${countryLabel}"`, // Quote strings
                    `"${indLabel}"`,
                    d.time,
                    d.obs_value,
                    d.unit_measure || '',
                    d.obs_status || ''
                ]);
            });
        });
    });

    const csvContent = rows.map(e => e.join(",")).join("\n");

    // Create a Blob for better browser compatibility and large file support
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `ilostat_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();

    // Clean up
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}


async function fetchAndCacheCountryData(countryCode) {
    // 1. Return from memory cache if exists
    if (state.countryDataCache[countryCode]) {
        return state.countryDataCache[countryCode];
    }

    // 2. Try IndexedDB
    const cached = await getFromDB(countryCode);
    if (cached) {
        console.log(`Using IndexedDB cache for ${countryCode}`);
        state.countryDataCache[countryCode] = cached.data;
        // Optional: Trigger background update if cache is old (> 1 day)
        return cached.data;
    }

    // 3. Try primary API
    const url = API.data(countryCode);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        const decompressed = fflate.gunzipSync(new Uint8Array(buffer));
        const csvText = new TextDecoder().decode(decompressed);

        const data = await parseCSV(csvText);
        state.countryDataCache[countryCode] = data;
        saveToDB(countryCode, data); // Save for future offline use
        return data;

    } catch (err) {
        console.warn(`Primary fetch failed for ${countryCode}, trying fallbacks...`, err);

        // 4. Try local sample fallback (e.g. for CHE - Switzerland)
        const sampleUrl = `${countryCode.toLowerCase()}_sample.csv.gz`;
        try {
            const resp = await fetch(sampleUrl);
            if (!resp.ok) throw new Error('No local sample');

            const buffer = await resp.arrayBuffer();
            const decompressed = fflate.gunzipSync(new Uint8Array(buffer));
            const csvText = new TextDecoder().decode(decompressed);

            const data = await parseCSV(csvText);
            state.countryDataCache[countryCode] = data;
            updateStatus(`Loaded local sample for ${countryCode}`);
            return data;
        } catch (fallbackErr) {
            throw new Error(`Failed to fetch and no local fallback available for ${countryCode}`);
        }
    }
}

function parseCSV(csvText) {
    return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data),
            error: (err) => reject(err)
        });
    });
}

// Helper to manage chart state (dimensions)
const chartStates = {}; // { 'indCode': { sex: 'SEX_T', classif1: null } }

function processAndRenderData() {
    const selectedCntryCodes = Array.from(state.selectedCountries);
    const selectedIndCodes = Array.from(state.selectedIndicators);

    els.chartsContainer.innerHTML = '';

    // Update Header
    els.reportTitle.textContent = `Comparative Profile`;
    els.reportMeta.textContent = `Comparing ${selectedCntryCodes.length} countries across ${selectedIndCodes.length} indicators`;


    // For each indicator, create a comparison chart
    selectedIndCodes.forEach(indCode => {
        // Find label
        const indicatorMeta = state.indicators.find(i => i.Code === indCode);
        const label = indicatorMeta ? indicatorMeta.Label : indCode;

        // Prepare datasets
        const datasets = [];
        let allLabels = new Set(); // To unify X-axis (years)

        // Collect Available Dimensions for this indicator across all countries
        const availableSexes = new Set();
        const availableClassif1 = new Set();

        selectedCntryCodes.forEach(countryCode => {
            const countryData = state.countryDataCache[countryCode];
            if (!countryData) return;

            let indData = countryData.filter(d => d.indicator === indCode);

            // Check available dimensions before filtering
            indData.forEach(d => {
                if (d.sex) availableSexes.add(d.sex);
                if (d.classif1) availableClassif1.add(d.classif1);
            });
        });

        // Initialize state if new or missing properties
        if (!chartStates[indCode]) {
            chartStates[indCode] = { sex: 'SEX_T', classif1: null };

            // Set default classif1 to a total/aggregate if available, otherwise first item
            if (availableClassif1.size > 0) {
                let bestValue = Array.from(availableClassif1).find(v =>
                    v.includes('_TOTAL') ||
                    v.includes('_AGGREGATE') ||
                    v.endsWith('_Total')
                );
                chartStates[indCode].classif1 = bestValue || Array.from(availableClassif1)[0];
            }
        }

        const currentSex = chartStates[indCode].sex;
        let currentClassif1 = chartStates[indCode].classif1;

        // Ensure current classif1 exists in available classif1
        if (availableClassif1.size > 0 && !availableClassif1.has(currentClassif1)) {
            let bestValue = Array.from(availableClassif1).find(v =>
                v.includes('_TOTAL') ||
                v.includes('_AGGREGATE') ||
                v.endsWith('_Total')
            );
            currentClassif1 = bestValue || Array.from(availableClassif1)[0];
            chartStates[indCode].classif1 = currentClassif1;
        }

        selectedCntryCodes.forEach((countryCode, idx) => {
            const countryData = state.countryDataCache[countryCode];
            if (!countryData) return;

            let indData = countryData.filter(d => d.indicator === indCode);

            // Filter by Time Period
            indData = indData.filter(d => parseInt(d.time) >= state.startYear);

            // Filter by Current Sex State if sex is present
            if (availableSexes.size > 0) {
                indData = indData.filter(d => d.sex === currentSex);
            }

            if (indData.length === 0) return;

            // Filter by classif1 if present
            if (availableClassif1.size > 0) {
                indData = indData.filter(d => d.classif1 === currentClassif1);
            }

            // Identify any OTHER classification columns present in the data (classif2, classif3, etc.)
            const otherClassificationKeys = Object.keys(indData[0]).filter(k => k.startsWith('classif') && k !== 'classif1');

            otherClassificationKeys.forEach(key => {
                // Check if this key has multiple values in the current filtered set
                const values = new Set(indData.map(d => d[key]));
                if (values.size <= 1) return; // Already unique

                // Try to find a "Total" or "Aggregate" value
                let bestValue = Array.from(values).find(v =>
                    v.includes('_TOTAL') ||
                    v.includes('_AGGREGATE') ||
                    v.endsWith('_Total')
                );

                // Fallback: If no Total, pick the first one (arbitrary but consistent)
                if (!bestValue) {
                    bestValue = Array.from(values)[0];
                }

                // Apply strict filter
                indData = indData.filter(d => d[key] === bestValue);
            });

            // Collect time points
            indData.forEach(d => allLabels.add(d.time));

            // Sort
            indData.sort((a, b) => parseInt(a.time) - parseInt(b.time));

            const countryLabel = state.countries.find(c => c.Code === countryCode)?.Label || countryCode;
            const colorBase = ILO_COLORS[idx % ILO_COLORS.length]; // Cycle through ILO palette

            datasets.push({
                label: countryLabel, // Or find Label from dictionary
                data: indData.map(d => ({ x: d.time, y: parseFloat(d.obs_value) })),
                borderColor: colorBase,
                backgroundColor: colorBase,
                borderWidth: 2,
                tension: 0.3,
                pointRadius: 3
            });
        });

        // Prepare Dimension Options FIRST, before checking if datasets is empty
        const dimensions = [];

        if (availableSexes.size > 1) {
            // Sort: Total, Female, Male
            const order = ['SEX_T', 'SEX_F', 'SEX_M'];
            const sexOptions = Array.from(availableSexes)
                .sort((a, b) => {
                    let idxA = order.indexOf(a);
                    let idxB = order.indexOf(b);
                    if (idxA === -1) idxA = 99;
                    if (idxB === -1) idxB = 99;
                    return idxA - idxB;
                })
                .map(sexCode => ({
                    value: sexCode,
                    label: state.classifications.sex[sexCode] || sexCode,
                    selected: sexCode === currentSex
                }));

            dimensions.push({
                type: 'sex',
                options: sexOptions
            });
        }

        if (availableClassif1.size > 1) {
            const classif1Options = Array.from(availableClassif1)
                // Try to put "total" formats at the top
                .sort((a, b) => {
                    const aIsTotal = a.includes('_TOTAL') || a.includes('_AGGREGATE');
                    const bIsTotal = b.includes('_TOTAL') || b.includes('_AGGREGATE');
                    if (aIsTotal && !bIsTotal) return -1;
                    if (!aIsTotal && bIsTotal) return 1;

                    // Then alphabetical by label
                    const labelA = state.classifications.classif1[a] || a;
                    const labelB = state.classifications.classif1[b] || b;
                    return labelA.localeCompare(labelB);
                })
                .map(cCode => ({
                    value: cCode,
                    label: state.classifications.classif1[cCode] || cCode,
                    selected: cCode === currentClassif1
                }));

            dimensions.push({
                type: 'classif1',
                options: classif1Options
            });
        }

        const onDimensionChange = (dimType, newValue) => {
            chartStates[indCode][dimType] = newValue;
            processAndRenderData();
        };

        if (datasets.length === 0) {
            renderEmptyChart(label, dimensions, onDimensionChange);
            return;
        }

        const sortedLabels = Array.from(allLabels).sort((a, b) => parseInt(a) - parseInt(b));
        createCompareChart(
            label,
            sortedLabels,
            datasets,
            dimensions,
            onDimensionChange
        );
    });
}

function renderEmptyChart(label, dimensions, onDimensionChange) {
    const div = document.createElement('div');
    div.className = 'chart-card';

    // Create header with possible dimensions even if empty
    const header = document.createElement('div');
    header.className = 'chart-header';

    const titleContainer = document.createElement('div');
    titleContainer.className = 'title-container';

    const h3 = document.createElement('h3');
    h3.textContent = label;
    titleContainer.appendChild(h3);

    if (dimensions && dimensions.length > 0) {
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'dimension-controls';

        dimensions.forEach(dimDef => {
            const select = document.createElement('select');
            select.className = 'dimension-select';

            dimDef.options.forEach(optVal => {
                const opt = document.createElement('option');
                opt.value = optVal.value;
                opt.textContent = optVal.label;
                opt.selected = optVal.selected;
                select.appendChild(opt);
            });
            if (onDimensionChange) {
                select.addEventListener('change', (e) => onDimensionChange(dimDef.type, e.target.value));
            }
            controlsDiv.appendChild(select);
        });

        titleContainer.appendChild(controlsDiv);
    }

    header.appendChild(titleContainer);
    div.appendChild(header);

    const msg = document.createElement('p');
    msg.style.textAlign = 'center';
    msg.style.color = '#94a3b8';
    msg.style.padding = '2rem';
    msg.textContent = 'No data available for selected dimension(s).';
    div.appendChild(msg);

    els.chartsContainer.appendChild(div);
}

function createCompareChart(title, labels, datasets, dimensions, onDimensionChange) {
    const div = document.createElement('div');
    div.className = 'chart-card';

    // Header container for title and actions
    const header = document.createElement('div');
    header.className = 'chart-header';

    // Title container
    const titleContainer = document.createElement('div');
    titleContainer.className = 'title-container';

    const h3 = document.createElement('h3');
    h3.textContent = title;
    titleContainer.appendChild(h3);

    // Add subtitle or dimension label
    if (dimensions && dimensions.length > 0) {
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'dimension-controls';

        dimensions.forEach(dimDef => {
            const select = document.createElement('select');
            select.className = 'dimension-select';

            // Optional: add a small label for clarity based on dimDef.type
            // if (dimDef.type === 'classif1') select.title = 'Classification';

            dimDef.options.forEach(optVal => {
                const opt = document.createElement('option');
                opt.value = optVal.value;
                opt.textContent = optVal.label;
                opt.selected = optVal.selected;
                select.appendChild(opt);
            });
            select.addEventListener('change', (e) => onDimensionChange(dimDef.type, e.target.value));
            controlsDiv.appendChild(select);
        });

        titleContainer.appendChild(controlsDiv);
    }

    header.appendChild(titleContainer);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'icon-btn';
    downloadBtn.innerHTML = '⬇️ PNG';
    downloadBtn.title = 'Download Chart Image';
    header.appendChild(downloadBtn);

    div.appendChild(header);

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'canvas-container';
    const canvas = document.createElement('canvas');
    canvasContainer.appendChild(canvas);
    div.appendChild(canvasContainer);

    els.chartsContainer.appendChild(div);

    const chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false
                },
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 20
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        color: '#f1f5f9'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });

    downloadBtn.addEventListener('click', () => downloadChart(chart, title));
}

function downloadChart(chart, title) {
    // strict safe-mode watermarking
    const watermarkText = "Made with ILOSTAT Explore, made by Dibyaudh Das, ILO, with data from ILO STAT public website";

    // Create a new canvas to combine chart and watermark
    const originalCanvas = chart.canvas;
    const padding = 40;
    const footerHeight = 50;

    const newCanvas = document.createElement('canvas');
    newCanvas.width = originalCanvas.width + (padding * 2);
    newCanvas.height = originalCanvas.height + (padding * 2) + footerHeight;
    const ctx = newCanvas.getContext('2d');

    // Fill background white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);

    // Draw Title
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, newCanvas.width / 2, 50);

    // Draw Chart
    // We need to use the original canvas image
    ctx.drawImage(originalCanvas, padding, padding + 30);

    // Draw Watermark
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(watermarkText, newCanvas.width - padding, newCanvas.height - 20);

    // Trigger Download
    const link = document.createElement('a');
    link.download = `${title.substring(0, 30).trim()} _ilostat.png`;
    link.href = newCanvas.toDataURL('image/png');
    link.click();
}

window.addEventListener('DOMContentLoaded', init);
