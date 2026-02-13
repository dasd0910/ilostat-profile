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
    selectedCountries: new Set(), // Set of country codes
    selectedIndicators: new Set(),
    countryDataCache: {}, // { code: data[] }
    status: 'idle'
};

// DOM Elements
const els = {
    countryTags: document.getElementById('country-tags'),
    countrySearch: document.getElementById('country-search'),
    countryList: document.getElementById('country-list'),

    indicatorList: document.getElementById('indicators-list'),
    indicatorSearch: document.getElementById('search-indicators'),
    btnSelectAllInd: document.getElementById('btn-select-all-ind'),
    btnClearInd: document.getElementById('btn-clear-ind'),

    generateBtn: document.getElementById('generate-btn'),
    statusMsg: document.getElementById('status-message'),
    chartsContainer: document.getElementById('charts-container'),
    reportTitle: document.getElementById('report-title'),
    reportMeta: document.getElementById('report-meta')
};

async function init() {
    updateStatus('Loading dictionaries...');
    try {
        const [countriesRaw, indicatorsRaw] = await Promise.all([
            fetchCSV(API.dic('ref_area')),
            fetchCSV(API.dic('indicator'))
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

        // Initial Render
        renderCountryList(); // Populate the dropdown list
        renderIndicators();

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

function renderIndicators() {
    els.indicatorList.innerHTML = '';
    const fragment = document.createDocumentFragment();

    state.indicators.forEach(ind => {
        const item = document.createElement('label');
        item.className = 'indicator-item';
        item.dataset.label = ind.Label.toLowerCase();

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = ind.Code;
        // Check if already selected (useful if we re-render)
        checkbox.checked = state.selectedIndicators.has(ind.Code);

        checkbox.addEventListener('change', (e) => toggleIndicator(ind, e.target.checked));

        const text = document.createElement('span');
        text.textContent = ind.Label;

        item.appendChild(checkbox);
        item.appendChild(text);
        fragment.appendChild(item);
    });

    els.indicatorList.appendChild(fragment);
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
        const term = e.target.value.toLowerCase();
        const items = els.indicatorList.querySelectorAll('.indicator-item');

        items.forEach(item => {
            const label = item.dataset.label;
            if (label.includes(term)) {
                item.classList.remove('hidden');
            } else {
                item.classList.add('hidden');
            }
        });
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
}

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
    } catch (err) {
        console.error(err);
        updateStatus('Error fetching data. Check console.');
        els.chartsContainer.innerHTML = '<div class="error-state">Error loading data.</div>';
    }
}

async function fetchAndCacheCountryData(countryCode) {
    // Return from cache if exists
    if (state.countryDataCache[countryCode]) {
        return state.countryDataCache[countryCode];
    }

    const url = API.data(countryCode);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${countryCode}`);

    const buffer = await response.arrayBuffer();
    const decompressed = fflate.gunzipSync(new Uint8Array(buffer));
    const csvText = new TextDecoder().decode(decompressed);

    return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                // Add country code to each row just in case (though ref_area should be there)
                state.countryDataCache[countryCode] = results.data;
                resolve(results.data);
            },
            error: (err) => reject(err)
        });
    });
}

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

        selectedCntryCodes.forEach((countryCode, idx) => {
            const countryData = state.countryDataCache[countryCode];
            if (!countryData) return;

            let indData = countryData.filter(d => d.indicator === indCode);
            if (indData.length === 0) return;

            // Simplify logic: Filter for Total/Aggregate
            if (indData[0].sex) indData = indData.filter(d => d.sex === 'SEX_T');
            if (indData.length > 0 && indData[0].classif1) {
                const totals = indData.filter(d => d.classif1.includes('_TOTAL') || d.classif1.includes('_AGGREGATE_TOTAL'));
                if (totals.length > 0) indData = totals;
                else {
                    const firstClassif = indData[0].classif1;
                    indData = indData.filter(d => d.classif1 === firstClassif);
                }
            }

            // Collect time points
            indData.forEach(d => allLabels.add(d.time));

            // Sort
            indData.sort((a, b) => parseInt(a.time) - parseInt(b.time));

            const countryLabel = state.countries.find(c => c.Code === countryCode)?.Label || countryCode;
            const colorBase = `hsl(${(idx * 137.5) % 360}, 70%, 50%)`; // Distinct colors

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

        if (datasets.length === 0) {
            renderEmptyChart(label);
            return;
        }

        const sortedLabels = Array.from(allLabels).sort((a, b) => parseInt(a) - parseInt(b));
        createCompareChart(label, sortedLabels, datasets);
    });
}

function renderEmptyChart(label) {
    const div = document.createElement('div');
    div.className = 'chart-card';
    div.innerHTML = `<h3>${label}</h3><p style="text-align:center; color:#94a3b8; padding: 2rem;">No data available for selected countries.</p>`;
    els.chartsContainer.appendChild(div);
}

function createCompareChart(title, labels, datasets) {
    const div = document.createElement('div');
    div.className = 'chart-card';

    // Header container for title and actions
    const header = document.createElement('div');
    header.className = 'chart-header';

    const h3 = document.createElement('h3');
    h3.textContent = title;
    header.appendChild(h3);

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
    link.download = `${title.substring(0, 30).trim()}_ilostat.png`;
    link.href = newCanvas.toDataURL('image/png');
    link.click();
}

window.addEventListener('DOMContentLoaded', init);
