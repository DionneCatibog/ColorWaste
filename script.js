// storage for incoming collection records
const mockData = [];

// normalize incoming record to expected shape
function normalizeRecord(rec) {
    const r = {
        date: rec && rec.date ? new Date(rec.date).toISOString() : new Date().toISOString(),
        recyclable: { paper: 0, plastic: 0, carton: 0 },
        residual: { paper: 0, plastic: 0, carton: 0 }
    };
    if (rec && rec.recyclable) {
        r.recyclable.paper = Number(rec.recyclable.paper) || 0;
        r.recyclable.plastic = Number(rec.recyclable.plastic) || 0;
        r.recyclable.carton = Number(rec.recyclable.carton) || 0;
    }
    if (rec && rec.residual) {
        r.residual.paper = Number(rec.residual.paper) || 0;
        r.residual.plastic = Number(rec.residual.plastic) || 0;
        r.residual.carton = Number(rec.residual.carton) || 0;
    }
    return r;
}

// Replace entire dataset (use for initial bulk sync)
function setData(array) {
    if (!Array.isArray(array)) return;
    mockData.length = 0;
    array.forEach(item => mockData.push(normalizeRecord(item)));
    // reset pagination to first page when a new dataset arrives
    state.collectionsCurrentPage = 1;
    refreshViews();
}

// Add a single record (new records expected to be newest first)
function addRecord(rec) {
    if (!rec) return;
    mockData.unshift(normalizeRecord(rec));
    // optional cap: mockData.length = Math.min(mockData.length, 5000);
    // if the new record is recent, ensure dashboard shows latest
    refreshViews();
}

// Generic receiver: accepts either a single record or an array
window.receiveData = function(payload) {
    try {
        if (!payload) return;

        if (payload.state && typeof payload.state === 'object') {
            Object.assign(state, payload.state);
        }

        if (Array.isArray(payload)) {
            setData(payload);
            return;
        }

        if (Array.isArray(payload.records)) {
            setData(payload.records);
            return;
        }

        if (Array.isArray(payload.data)) {
            setData(payload.data);
            return;
        }

        if (payload.record) {
            addRecord(payload.record);
        } else if (payload.data && payload.type === 'record') {
            addRecord(payload.data);
        } else if (payload.compartments) {
            window.setCompartments(payload.compartments);
        } else if (payload.type === 'batch' && Array.isArray(payload.items)) {
            setData(payload.items);
        } else if (payload.type === 'batch' && Array.isArray(payload.data)) {
            setData(payload.data);
        } else if (payload.type === 'record' && payload.data) {
            addRecord(payload.data);
        } else if (payload.date && (payload.recyclable || payload.residual)) {
            // assume it's a single record
            addRecord(payload);
        }

        // after handling payload, refresh views to make sure UI reflects merged state
        refreshViews();
    } catch (err) {
        console.error('receiveData error', err);
    }
};

// Optional WebSocket client to receive live updates from a server
function initDataSocket(url) {
    if (!url) return;
    let ws;
    function connect() {
        ws = new WebSocket(url);
        ws.addEventListener('open', () => console.info('data socket open'));
        ws.addEventListener('message', evt => {
            try {
                const msg = JSON.parse(evt.data);
                // reuse receiveData for routing/parsing
                window.receiveData(msg);
            } catch (e) {
                console.error('socket message parse error', e);
            }
        });
        ws.addEventListener('close', () => setTimeout(connect, 1000));
        ws.addEventListener('error', () => ws && ws.close());
    }
    connect();
    window.initDataSocket = initDataSocket;
    return { close: () => ws && ws.close() };
}

// Allow external updates for compartments (e.g. from sensors)
window.setCompartments = function(arr) {
    if (!Array.isArray(arr)) return;
    // Replace or merge compartments depending on incoming payload
    // If incoming items include id, update matching id; otherwise replace whole list
    const hasIds = arr.every(c => typeof c.id !== 'undefined');
    if (hasIds) {
        // update existing compartments by id or add new ones
        arr.forEach(c => {
            const idx = state.compartments.findIndex(sc => sc.id === c.id);
            const updated = {
                id: c.id,
                type: c.type || c.name || '',
                items: Number(c.items) || 0,
                capacity: Number(c.capacity) || 100,
                isFull: !!c.isFull
            };
            if (idx >= 0) state.compartments[idx] = Object.assign({}, state.compartments[idx], updated);
            else state.compartments.push(updated);
        });
    } else {
        // replace entirely
        state.compartments = arr.map(c => ({
            id: c.id,
            type: c.type || c.name || '',
            items: Number(c.items) || 0,
            capacity: Number(c.capacity) || 100,
            isFull: !!c.isFull
        }));
    }
    if (state.currentPage === 'bin-monitoring') renderCompartments();
};

// Helper to refresh UI views after data changes
function refreshViews() {
    // update dashboard and collections and bin monitoring when relevant
    if (state.currentPage === 'dashboard') {
        updateDashboardStats();
        updateDashboardCharts();
        updateSummaryTable();
    }
    if (state.currentPage === 'collections') {
        updateCollectionsStats();
        updateCollectionsTable();
    }
    if (state.currentPage === 'bin-monitoring') renderCompartments();
}

// State Management
const state = {
    currentPage: 'dashboard',
    theme: localStorage.getItem('theme') || 'light',
    dashboardFilter: 'daily',
    collectionsFilter: 'daily',
    collectionsCurrentPage: 1,
    collectionsPerPage: 15,
    collectionsSearchQuery: '',
    collectionsCategoryFilter: 'all',
    customDateRange: {
        start: null,
        end: null
    },
    collectionsCustomDateRange: {
        start: null,
        end: null
    },
    compartments: [
        { id: 1, type: 'Recyclable - Paper', items: 0, capacity: 100, isFull: false },
        { id: 2, type: 'Recyclable - Plastic', items: 0, capacity: 100, isFull: false },
        { id: 3, type: 'Recyclable - Carton', items: 0, capacity: 100, isFull: false },
        { id: 4, type: 'Residual - Paper', items: 0, capacity: 100, isFull: false },
        { id: 5, type: 'Residual - Plastic', items: 0, capacity: 100, isFull: false },
        { id: 6, type: 'Residual - Carton', items: 0, capacity: 100, isFull: false },
        { id: 7, type: 'Biodegradable', items: 0, capacity: 100, isFull: false }
    ]
};

// Theme Toggle
function initTheme() {
    document.body.className = state.theme + '-theme';
    const icon = document.querySelector('#themeToggle i');
    icon.className = state.theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
}

document.getElementById('themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', state.theme);
    initTheme();
});

// Navigation
function initNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    state.currentPage = page;
    
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });
    
    // Update pages
    document.querySelectorAll('.page').forEach(pageEl => {
        pageEl.classList.toggle('active', pageEl.id === page + '-page');
    });
    
    // Load page content
    if (page === 'dashboard') {
        loadDashboard();
    } else if (page === 'collections') {
        loadCollections();
    } else if (page === 'bin-monitoring') {
        loadBinMonitoring();
    }
}

// Date Filtering
function getFilteredData(filterType, customRange = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return mockData.filter(item => {
        const itemDate = new Date(item.date);
        itemDate.setHours(0, 0, 0, 0);

        if (filterType === 'daily') {
            return itemDate.getTime() === today.getTime();
        } else if (filterType === 'weekly') {
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return itemDate >= weekAgo && itemDate <= today;
        } else if (filterType === 'monthly') {
            const monthAgo = new Date(today);
            monthAgo.setDate(monthAgo.getDate() - 30);
            return itemDate >= monthAgo && itemDate <= today;
        } else if (filterType === 'custom' && customRange) {
            return itemDate >= customRange.start && itemDate <= customRange.end;
        }
        return true;
    });
}

function aggregateData(data) {
    const totals = {
        recyclable: { paper: 0, plastic: 0, carton: 0 },
        residual: { paper: 0, plastic: 0, carton: 0 }
    };
    
    data.forEach(item => {
        totals.recyclable.paper += item.recyclable.paper;
        totals.recyclable.plastic += item.recyclable.plastic;
        totals.recyclable.carton += item.recyclable.carton;
        totals.residual.paper += item.residual.paper;
        totals.residual.plastic += item.residual.plastic;
        totals.residual.carton += item.residual.carton;
    });
    
    return totals;
}

// Helper function to check if data is empty
function isEmptyData(data) {
    return !data || data.length === 0;
}

// Helper function to draw "No data" message on canvas
function drawNoDataOnCanvas(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary');
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}

// Dashboard Page
function loadDashboard() {
    setupDashboardFilters();
    updateDashboardStats();
    updateDashboardCharts();
    updateSummaryTable();
}

function setupDashboardFilters() {
    document.querySelectorAll('#dashboard-page .filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#dashboard-page .filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.dashboardFilter = tab.dataset.filter;
            
            const customInputs = document.getElementById('customDateInputs');
            customInputs.style.display = state.dashboardFilter === 'custom' ? 'flex' : 'none';
            
            if (state.dashboardFilter !== 'custom') {
                updateDashboardStats();
                updateDashboardCharts();
                updateSummaryTable();
            }
        });
    });
    
    document.getElementById('applyCustomDate').addEventListener('click', () => {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        if (startDate && endDate) {
            state.customDateRange = {
                start: new Date(startDate),
                end: new Date(endDate)
            };
            updateDashboardStats();
            updateDashboardCharts();
            updateSummaryTable();
        }
    });
}

function updateDashboardStats() {
    const filteredData = getFilteredData(
        state.dashboardFilter,
        state.dashboardFilter === 'custom' ? state.customDateRange : null
    );

    if (isEmptyData(filteredData)) {
        // Show placeholders when no data
        document.getElementById('totalItems').textContent = '-';
        document.getElementById('recyclableItems').textContent = '-';
        document.getElementById('residualItems').textContent = '-';
        return;
    }

    const totals = aggregateData(filteredData);

    const totalRecyclable = totals.recyclable.paper + totals.recyclable.plastic + totals.recyclable.carton;
    const totalResidual = totals.residual.paper + totals.residual.plastic + totals.residual.carton;
    const totalItems = totalRecyclable + totalResidual;

    document.getElementById('totalItems').textContent = totalItems.toLocaleString();
    document.getElementById('recyclableItems').textContent = totalRecyclable.toLocaleString();
    document.getElementById('residualItems').textContent = totalResidual.toLocaleString();
}

let distributionChart = null;
let trendChart = null;

function updateDashboardCharts() {
    const filteredData = getFilteredData(
        state.dashboardFilter,
        state.dashboardFilter === 'custom' ? state.customDateRange : null
    );

    // If no data, destroy existing charts and draw "No data" placeholders
    if (isEmptyData(filteredData)) {
        if (distributionChart) {
            distributionChart.destroy();
            distributionChart = null;
        }
        if (trendChart) {
            trendChart.destroy();
            trendChart = null;
        }
        drawNoDataOnCanvas('distributionChart', 'No data to display');
        drawNoDataOnCanvas('trendChart', 'No data to display');
        return;
    }

    const totals = aggregateData(filteredData);

    // Distribution Chart (Pie)
    const distCtx = document.getElementById('distributionChart').getContext('2d');

    if (distributionChart) {
        distributionChart.destroy();
    }

    distributionChart = new Chart(distCtx, {
        type: 'doughnut',
        data: {
            labels: ['Recyclable Paper', 'Recyclable Plastic', 'Recyclable Carton', 
                     'Residual Paper', 'Residual Plastic', 'Residual Carton'],
            datasets: [{
                data: [
                    totals.recyclable.paper,
                    totals.recyclable.plastic,
                    totals.recyclable.carton,
                    totals.residual.paper,
                    totals.residual.plastic,
                    totals.residual.carton
                ],
                backgroundColor: [
                    '#10b981',
                    '#059669',
                    '#047857',
                    '#ef4444',
                    '#dc2626',
                    '#b91c1c'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-primary')
                    }
                }
            }
        }
    });

    // Trend Chart (Line)
    const trendCtx = document.getElementById('trendChart').getContext('2d');

    if (trendChart) {
        trendChart.destroy();
    }

    const last7Days = filteredData.slice(0, 7).reverse();
    const labels = last7Days.map(d => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const recyclableData = last7Days.map(d => d.recyclable.paper + d.recyclable.plastic + d.recyclable.carton);
    const residualData = last7Days.map(d => d.residual.paper + d.residual.plastic + d.residual.carton);

    trendChart = new Chart(trendCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Recyclable',
                    data: recyclableData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4
                },
                {
                    label: 'Residual',
                    data: residualData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-primary')
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-secondary')
                    },
                    grid: {
                        color: getComputedStyle(document.body).getPropertyValue('--border-color')
                    }
                },
                x: {
                    ticks: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-secondary')
                    },
                    grid: {
                        color: getComputedStyle(document.body).getPropertyValue('--border-color')
                    }
                }
            }
        }
    });
}

function updateSummaryTable() {
    const filteredData = getFilteredData(
        state.dashboardFilter,
        state.dashboardFilter === 'custom' ? state.customDateRange : null
    );

    const tbody = document.getElementById('summaryTableBody');
    tbody.innerHTML = '';

    if (isEmptyData(filteredData)) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
        `;
        tbody.appendChild(row);
        return;
    }

    filteredData.slice(0, 10).forEach(item => {
        const totalRecyclable = item.recyclable.paper + item.recyclable.plastic + item.recyclable.carton;
        const totalResidual = item.residual.paper + item.residual.plastic + item.residual.carton;
        const totalItems = totalRecyclable + totalResidual;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(item.date).toLocaleDateString()}</td>
            <td>${totalItems}</td>
            <td>${totalRecyclable}</td>
            <td>${totalResidual}</td>
        `;
        tbody.appendChild(row);
    });
}

// Collections Page
function loadCollections() {
    setupCollectionsFilters();
    updateCollectionsStats();
    updateCollectionsTable();
}

function setupCollectionsFilters() {
    document.querySelectorAll('.collections-filter').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.collections-filter').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.collectionsFilter = tab.dataset.filter;
            state.collectionsCurrentPage = 1;
            
            const customInputs = document.getElementById('collectionsCustomDateInputs');
            customInputs.style.display = state.collectionsFilter === 'custom' ? 'flex' : 'none';
            
            if (state.collectionsFilter !== 'custom') {
                updateCollectionsStats();
                updateCollectionsTable();
            }
        });
    });
    
    document.getElementById('collectionsApplyCustomDate').addEventListener('click', () => {
        const startDate = document.getElementById('collectionsStartDate').value;
        const endDate = document.getElementById('collectionsEndDate').value;
        if (startDate && endDate) {
            state.collectionsCustomDateRange = {
                start: new Date(startDate),
                end: new Date(endDate)
            };
            state.collectionsCurrentPage = 1;
            updateCollectionsStats();
            updateCollectionsTable();
        }
    });

    // Search functionality
    const searchInput = document.getElementById('collectionsSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.collectionsSearchQuery = e.target.value.toLowerCase();
            state.collectionsCurrentPage = 1;
            updateCollectionsTable();
        });
    }

    // Category filter functionality
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
            state.collectionsCategoryFilter = e.target.value;
            state.collectionsCurrentPage = 1;
            updateCollectionsStats();
            updateCollectionsTable();
        });
    }
}

function updateCollectionsStats() {
    const filteredData = getFilteredData(
        state.collectionsFilter,
        state.collectionsFilter === 'custom' ? state.collectionsCustomDateRange : null
    );

    if (isEmptyData(filteredData)) {
        document.getElementById('collectionsTotal').textContent = '0';
        document.getElementById('collectionsRecyclable').textContent = '0';
        document.getElementById('collectionsResidual').textContent = '0';
        return;
    }

    const totals = aggregateData(filteredData);

    const totalRecyclable = totals.recyclable.paper + totals.recyclable.plastic + totals.recyclable.carton;
    const totalResidual = totals.residual.paper + totals.residual.plastic + totals.residual.carton;
    const totalItems = totalRecyclable + totalResidual;

    document.getElementById('collectionsTotal').textContent = totalItems.toLocaleString();
    document.getElementById('collectionsRecyclable').textContent = totalRecyclable.toLocaleString();
    document.getElementById('collectionsResidual').textContent = totalResidual.toLocaleString();
}

function updateCollectionsTable() {
    let filteredData = getFilteredData(
        state.collectionsFilter,
        state.collectionsFilter === 'custom' ? state.collectionsCustomDateRange : null
    );

    // Apply category filter
    if (state.collectionsCategoryFilter !== 'all') {
        filteredData = filteredData.filter(item => {
            const recyclableTotal = item.recyclable.paper + item.recyclable.plastic + item.recyclable.carton;
            const residualTotal = item.residual.paper + item.residual.plastic + item.residual.carton;
            
            if (state.collectionsCategoryFilter === 'recyclable') {
                return recyclableTotal > 0;
            } else if (state.collectionsCategoryFilter === 'residual') {
                return residualTotal > 0;
            }
            return true;
        });
    }

    // Apply search filter
    if (state.collectionsSearchQuery) {
        filteredData = filteredData.filter(item => {
            const dateStr = new Date(item.date).toLocaleDateString().toLowerCase();
            return dateStr.includes(state.collectionsSearchQuery);
        });
    }

    const tbody = document.getElementById('collectionsTableBody');
    tbody.innerHTML = '';

    if (isEmptyData(filteredData)) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="10" style="text-align: center;">No data available</td>
        `;
        tbody.appendChild(row);
        
        // Clear pagination
        const pagination = document.getElementById('collectionsPagination');
        if (pagination) pagination.innerHTML = '';
        return;
    }

    // Pagination
    const startIndex = (state.collectionsCurrentPage - 1) * state.collectionsPerPage;
    const endIndex = startIndex + state.collectionsPerPage;
    const paginatedData = filteredData.slice(startIndex, endIndex);

    paginatedData.forEach(item => {
        const totalRecyclable = item.recyclable.paper + item.recyclable.plastic + item.recyclable.carton;
        const totalResidual = item.residual.paper + item.residual.plastic + item.residual.carton;
        const totalItems = totalRecyclable + totalResidual;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(item.date).toLocaleDateString()}</td>
            <td>${totalItems}</td>
            <td>${totalRecyclable}</td>
            <td>${item.recyclable.paper}</td>
            <td>${item.recyclable.plastic}</td>
            <td>${item.recyclable.carton}</td>
            <td>${totalResidual}</td>
            <td>${item.residual.paper}</td>
            <td>${item.residual.plastic}</td>
            <td>${item.residual.carton}</td>
        `;
        tbody.appendChild(row);
    });

    // Update pagination controls
    updatePaginationControls(filteredData.length);
}

function updatePaginationControls(totalItems) {
    const pagination = document.getElementById('collectionsPagination');
    if (!pagination) return;
    
    pagination.innerHTML = '';
    
    const totalPages = Math.ceil(totalItems / state.collectionsPerPage);
    
    if (totalPages <= 1) return;

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevBtn.disabled = state.collectionsCurrentPage === 1;
    prevBtn.addEventListener('click', () => {
        if (state.collectionsCurrentPage > 1) {
            state.collectionsCurrentPage--;
            updateCollectionsTable();
        }
    });
    pagination.appendChild(prevBtn);

    // Page numbers
    const maxPagesToShow = 5;
    let startPage = Math.max(1, state.collectionsCurrentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.textContent = '1';
        firstBtn.addEventListener('click', () => {
            state.collectionsCurrentPage = 1;
            updateCollectionsTable();
        });
        pagination.appendChild(firstBtn);

        if (startPage > 2) {
            const dots = document.createElement('span');
            dots.textContent = '...';
            dots.className = 'pagination-info';
            pagination.appendChild(dots);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.classList.toggle('active', i === state.collectionsCurrentPage);
        pageBtn.addEventListener('click', () => {
            state.collectionsCurrentPage = i;
            updateCollectionsTable();
        });
        pagination.appendChild(pageBtn);
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const dots = document.createElement('span');
            dots.textContent = '...';
            dots.className = 'pagination-info';
            pagination.appendChild(dots);
        }

        const lastBtn = document.createElement('button');
        lastBtn.textContent = totalPages;
        lastBtn.addEventListener('click', () => {
            state.collectionsCurrentPage = totalPages;
            updateCollectionsTable();
        });
        pagination.appendChild(lastBtn);
    }

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextBtn.disabled = state.collectionsCurrentPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (state.collectionsCurrentPage < totalPages) {
            state.collectionsCurrentPage++;
            updateCollectionsTable();
        }
    });
    pagination.appendChild(nextBtn);

    // Info
    const info = document.createElement('span');
    info.className = 'pagination-info';
    info.textContent = `Page ${state.collectionsCurrentPage} of ${totalPages}`;
    pagination.appendChild(info);
}

// Bin Monitoring Page
function loadBinMonitoring() {
    renderCompartments();
    setupBinMonitoringListeners();
}

function renderCompartments() {
    const grid = document.getElementById('compartmentsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    // Icon mapping for compartment types
    const iconMap = {
        'Recyclable - Paper': '<i class="fas fa-recycle"></i>',
        'Recyclable - Plastic': '<i class="fas fa-recycle"></i>',
        'Recyclable - Carton': '<i class="fas fa-recycle"></i>',
        'Residual - Paper': '<i class="fas fa-trash-alt"></i>',
        'Residual - Plastic': '<i class="fas fa-trash-alt"></i>',
        'Residual - Carton': '<i class="fas fa-trash-alt"></i>',
        'Biodegradable': '<i class="fas fa-leaf"></i>'
    };
    
    // Determine card class based on type
    const getCardClass = (type) => {
        if (type.includes('Recyclable')) return 'recyclable';
        if (type.includes('Residual')) return 'residual';
        if (type.includes('Biodegradable')) return 'biodegradable';
        return '';
    };
    
    state.compartments.forEach(compartment => {
        const card = document.createElement('div');
        card.className = `compartment-card ${getCardClass(compartment.type)}`;
        
        const statusText = compartment.isFull ? 'Full' : 'Empty';
        const statusClass = compartment.isFull ? 'full' : 'empty';
        const icon = iconMap[compartment.type] || '<i class="fas fa-box"></i>';
        
        card.innerHTML = `
            <div class="compartment-header">
                <div class="compartment-title">
                    <span class="compartment-icon">${icon}</span>
                    <span>${compartment.type}</span>
                </div>
                <div class="compartment-status">
                    <span class="status-indicator ${statusClass}"></span>
                    <span>${statusText}</span>
                </div>
            </div>
            <div class="compartment-details">
                <div class="detail-row">
                    <span class="detail-label">Items:</span>
                    <span class="detail-value">${compartment.items}</span>
                </div>
            </div>
            <div class="compartment-actions">
                <button class="compartment-btn reset" data-id="${compartment.id}">
                    <i class="fas fa-sync-alt"></i> Reset
                </button>
            </div>
        `;
        
        grid.appendChild(card);
    });
    
    // Add event listeners to reset buttons
    document.querySelectorAll('.compartment-btn.reset').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            resetCompartment(id);
        });
    });
}

function setupBinMonitoringListeners() {
    document.getElementById('resetAllCompartments').addEventListener('click', () => {
        state.compartments.forEach(compartment => {
            compartment.items = 0;
            compartment.isFull = false;
        });
        renderCompartments();
    });
}

function resetCompartment(id) {
    const compartment = state.compartments.find(c => c.id === id);
    if (compartment) {
        compartment.items = 0;
        compartment.isFull = false;
        renderCompartments();
    }
}

// Simulate sensor updates
function simulateSensorUpdates() {
    setInterval(() => {
        state.compartments.forEach(compartment => {
            // Randomly add items (10% chance each second)
            if (Math.random() < 0.1 && compartment.items < compartment.capacity) {
                compartment.items += Math.floor(Math.random() * 3) + 1;
                compartment.items = Math.min(compartment.items, compartment.capacity);
                
                // Mark as full if 90% or more
                if (compartment.items >= compartment.capacity * 0.9) {
                    compartment.isFull = true;
                }
            }
        });
        
        // Only update if we're on the bin monitoring page
        if (state.currentPage === 'bin-monitoring') {
            renderCompartments();
        }
    }, 1000);
}

// Initialize App
function init() {
    initTheme();
    initNavigation();
    
    // Check URL hash on load and navigate to that page
    const hash = window.location.hash.substring(1); // Remove the #
    if (hash && ['dashboard', 'collections', 'bin-monitoring'].includes(hash)) {
        navigateTo(hash);
    } else {
        navigateTo('dashboard'); // Default to dashboard
    }
}

// Handle browser back/forward buttons
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.substring(1);
    if (hash && ['dashboard', 'collections', 'bin-monitoring'].includes(hash)) {
        navigateTo(hash);
    }
});

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}