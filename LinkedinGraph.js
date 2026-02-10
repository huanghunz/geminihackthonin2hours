import { GoogleGenAI } from "@google/genai";

// AI Service Abstraction
class AIService {
    constructor() {
        this.provider = 'gemini'; // Default
        this.apiKey = ""; // Default Hackathon Key
        this.client = null; // Lazy initialization
    }

    getClient() {
        if (!this.client && this.provider === 'gemini') {
            this.client = new GoogleGenAI({ apiKey: this.apiKey });
        }
        return this.client;
    }

    setProvider(provider, key) {
        this.provider = provider;
        if (key) {
             this.apiKey = key;
        }
        // Reset client so it gets recreated with new key on next use
        this.client = null;
    }

    async generateContent(prompt) {
        if (this.provider === 'gemini') {
            return this.callGemini(prompt);
        } else if (this.provider === 'openai') {
            return this.callOpenAI(prompt);
        }
        throw new Error("Unknown provider");
    }

    async callGemini(prompt) {
        const client = this.getClient();
        const response = await client.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
        });

        if (typeof response.text === 'function') {
            return response.text();
        } else if (typeof response.text === 'string') {
            return response.text;
        } else {
            return response.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
    }

    async callOpenAI(prompt) {
        if (!this.apiKey || this.apiKey.startsWith("AIza")) {
            throw new Error("Please provide a valid OpenAI API Key in the settings.");
        }
        const url = "https://api.openai.com/v1/chat/completions";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.choices[0].message.content;
    }
}

const aiService = new AIService();

// Global State
let svg = null;
let g = null;
let simulation = null;
let masterNodes = [];
let globalNodes = [];
let globalLinks = [];
let lastAIResult = null;
let userProfile = {};
let selectedNode = null;
let zoom = null;
let timeScale = null;
let yearGroups = {};

// Constants
const TIMELINE_WIDTH = 120;
const NODE_RADIUS_MIN = 3;
const NODE_RADIUS_MAX = 12;
const LINK_DISTANCE_BASE = 120; // Increased from 50 for more spacing

// --- DATE HELPER ---
function parseConnectionDate(dateStr) {
    if (!dateStr) return new Date(0);
    return new Date(dateStr);
}

// --- VISUALIZATION SETUP ---
function initVisualization() {
    const container = d3.select('#container');
    container.selectAll('*').remove();

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Create SVG
    svg = container.append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background', '#000');

    // Create main group with zoom
    zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);

    g = svg.append('g');

    // Create timeline axis group (hidden)
    const timelineGroup = g.append('g')
        .attr('class', 'timeline-axis')
        .attr('transform', `translate(${TIMELINE_WIDTH}, 0)`)
        .style('display', 'none'); // Hide timeline

    // Create network group (for nodes and links) - start from left edge since timeline is hidden
    const networkGroup = g.append('g')
        .attr('class', 'network')
        .attr('transform', 'translate(20, 0)'); // Start from left edge

    // Store groups for later use
    g.timelineGroup = timelineGroup;
    g.networkGroup = networkGroup;
}

// --- LAYOUT LOGIC ---
function updateLayout() {
    if (!g || globalNodes.length === 0) return;

    const mode = document.getElementById('layout-mode').value;
    const width = window.innerWidth - 40; // Full width since timeline is hidden
    const height = window.innerHeight;

    // Calculate time scale
    const dates = globalNodes.filter(n => n.id !== 'ME').map(n => n.connectedDate.getTime());
    const minTime = Math.min(...dates);
    const maxTime = Math.max(...dates);
    const timeSpan = maxTime - minTime || 1;

    // Y-axis: Time (vertical timeline)
    timeScale = d3.scaleTime()
        .domain([new Date(minTime), new Date(maxTime)])
        .range([50, height - 50]);

    // Draw timeline axis (hidden)
    // drawTimelineAxis(timeScale, height);

    // Update node positions based on mode
    if (mode === 'timeline') {
        layoutTimeline(width, height, timeScale);
    } else if (mode === 'clusters') {
        layoutClusters(width, height, timeScale);
    } else if (mode === 'organic') {
        layoutOrganic(width, height, timeScale);
    }

    // Render visualization
    renderVisualization();
}

function drawTimelineAxis(scale, height) {
    const timelineGroup = g.select('.timeline-axis');
    timelineGroup.selectAll('*').remove();

    // Create axis
    const axis = d3.axisLeft(scale)
        .ticks(d3.timeYear.every(1))
        .tickFormat(d3.timeFormat('%Y'));

    timelineGroup.append('g')
        .attr('class', 'axis')
        .attr('transform', 'translate(0, 0)')
        .call(axis)
        .selectAll('text')
        .style('fill', '#fff')
        .style('font-size', '12px');

    // Style axis line
    timelineGroup.selectAll('.domain, .tick line')
        .style('stroke', '#666')
        .style('stroke-width', 1);

    // Add year markers
    const years = d3.timeYears(scale.domain()[0], scale.domain()[1]);
    years.forEach(year => {
        const y = scale(year);
        timelineGroup.append('line')
            .attr('x1', 0)
            .attr('x2', -10)
            .attr('y1', y)
            .attr('y2', y)
            .style('stroke', '#444')
            .style('stroke-width', 1);
    });
}

function layoutTimeline(width, height, timeScale) {
    // Timeline layout: nodes positioned by date (Y) and spread horizontally (X)
    globalNodes.forEach((node, i) => {
        if (node.id === 'ME') {
            node.fx = width / 2;
            node.fy = height / 2;
        } else {
            // Y position based on date
            node.fy = timeScale(node.connectedDate);
            // X position: spread horizontally with some randomness
            const yearIndex = node.connectedDate.getFullYear();
            const nodesInYear = globalNodes.filter(n =>
                n.id !== 'ME' && n.connectedDate.getFullYear() === yearIndex
            ).length;
            const indexInYear = globalNodes.filter(n =>
                n.id !== 'ME' && n.connectedDate.getFullYear() === yearIndex &&
                n.connectedDate <= node.connectedDate
            ).length;

            // Spread nodes horizontally within year
            const spacing = Math.min(width / (nodesInYear + 1), 180); // Increased from 100 to 180
            node.fx = (indexInYear * spacing) + (width / 2 - (nodesInYear * spacing) / 2);
        }
    });
}

function layoutClusters(width, height, timeScale) {
    // Cluster by year: group nodes by year, then cluster horizontally
    const yearMap = {};
    globalNodes.forEach(node => {
        if (node.id === 'ME') return;
        const year = node.connectedDate.getFullYear();
        if (!yearMap[year]) yearMap[year] = [];
        yearMap[year].push(node);
    });

    // Position ME at center
    const meNode = globalNodes.find(n => n.id === 'ME');
    if (meNode) {
        meNode.fx = width / 2;
        meNode.fy = height / 2;
    }

    // Position nodes in year clusters
    const years = Object.keys(yearMap).sort((a, b) => b - a);
    years.forEach((year, yearIdx) => {
        const nodes = yearMap[year];
        const avgY = d3.mean(nodes.map(n => timeScale(n.connectedDate)));
        const clusterWidth = Math.min(width * 0.7, nodes.length * 60); // Increased from 30 to 60
        const startX = (width - clusterWidth) / 2;

        nodes.forEach((node, nodeIdx) => {
            node.fy = avgY;
            node.fx = startX + (nodeIdx * (clusterWidth / (nodes.length || 1)));
        });
    });
}

function layoutOrganic(width, height, timeScale) {
    // Organic: use force simulation with time-based constraints
    // ME at center
    const meNode = globalNodes.find(n => n.id === 'ME');
    if (meNode) {
        meNode.fx = width / 2;
        meNode.fy = height / 2;
    }

    // Other nodes: Y constrained by time, X free
    globalNodes.forEach(node => {
        if (node.id !== 'ME') {
            node.fy = timeScale(node.connectedDate);
            node.fx = null; // Let force simulation determine X
        }
    });
}

function renderVisualization() {
    const networkGroup = g.select('.network');
    networkGroup.selectAll('*').remove();

    // Create link elements
    const link = networkGroup.selectAll('.link')
        .data(globalLinks)
        .enter()
        .append('line')
        .attr('class', 'link')
        .style('stroke', '#555')
        .style('stroke-width', 1)
        .style('stroke-opacity', 0.3);

    // Create node elements
    const node = networkGroup.selectAll('.node')
        .data(globalNodes)
        .enter()
        .append('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')
        .call(d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded));

    // Add circles
    node.append('circle')
        .attr('r', d => {
            if (d.id === 'ME') return 15;
            // Size based on recency (newer = larger)
            const dates = globalNodes.filter(n => n.id !== 'ME').map(n => n.connectedDate.getTime());
            const minTime = Math.min(...dates);
            const maxTime = Math.max(...dates);
            const timeSpan = maxTime - minTime || 1;
            const recency = (d.connectedDate.getTime() - minTime) / timeSpan;
            return NODE_RADIUS_MIN + (recency * (NODE_RADIUS_MAX - NODE_RADIUS_MIN));
        })
        .style('fill', d => {
            if (d.id === 'ME') return '#fff';
            // Color by year
            const year = d.connectedDate.getFullYear();
            const hue = (year % 10) * 36; // Cycle through hues
            return d3.hsl(hue, 0.7, 0.6).toString();
        })
        .style('stroke', '#fff')
        .style('stroke-width', 1.5);

    // Add labels
    node.append('text')
        .text(d => d.name.split(' ')[0]) // First name only
        .attr('dx', d => (d.id === 'ME' ? 20 : 8))
        .attr('dy', 4)
        .style('fill', '#fff')
        .style('font-size', d => d.id === 'ME' ? '14px' : '10px')
        .style('pointer-events', 'none');

    // Add tooltips
    node.append('title')
        .text(d => `${d.name}\n${d.role}\n${d.company}\n${d.connectedDate.toLocaleDateString()}`);

    // Force simulation
    simulation = d3.forceSimulation(globalNodes)
        .force('link', d3.forceLink(globalLinks)
            .id(d => d.id)
            .distance(LINK_DISTANCE_BASE)
            .strength(0.1))
        .force('charge', d3.forceManyBody()
            .strength(d => d.id === 'ME' ? -800 : -150)) // Increased repulsion: -50 to -150, ME: -500 to -800
        .force('x', d3.forceX(d => {
            if (d.fx !== undefined) return d.fx;
            return window.innerWidth / 2;
        }).strength(0.1))
        .force('y', d3.forceY(d => {
            if (d.fy !== undefined) return d.fy;
            return window.innerHeight / 2;
        }).strength(0.3))
        .on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

    // Click handler
    node.on('click', (event, d) => {
        selectedNode = d;
        updateSidebarForPerson(d);

        // Highlight selected node
        node.select('circle')
            .style('stroke-width', n => n.id === d.id ? 4 : 1.5)
            .style('stroke', n => n.id === d.id ? '#00ff88' : '#fff');

        // Highlight selected item in list
        document.querySelectorAll('.filtered-node-item').forEach(item => {
            if (item.dataset.nodeId === d.id) {
                item.style.background = '#d0e8ff';
                item.style.border = '2px solid #0077b5';
            } else {
                item.style.background = '#f0f0f0';
                item.style.border = 'none';
            }
        });
    });
}

function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    // Keep Y position fixed (time-based), allow X to be free
    if (d.id !== 'ME') {
        d.fx = null;
    }
}

// --- FILTER LOGIC ---
function populateYearFilter(nodes) {
    const filterSelect = document.getElementById('year-filter');
    filterSelect.innerHTML = '<option value="all">All Years</option>';

    const years = new Set();
    nodes.forEach(n => {
        if (n.id !== 'ME' && n.connectedDate) {
            years.add(n.connectedDate.getFullYear());
        }
    });

    const sortedYears = Array.from(years).sort((a, b) => b - a);

    sortedYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.innerText = year;
        filterSelect.appendChild(option);
    });
}

function applyYearFilter() {
    const year = document.getElementById('year-filter').value;
    const ME_ID = 'ME';

    let filteredNodes = [];
    if (year === 'all') {
        filteredNodes = [...masterNodes];
    } else {
        const targetYear = parseInt(year);
        filteredNodes = masterNodes.filter(n =>
            n.id === ME_ID || n.connectedDate.getFullYear() === targetYear
        );
    }

    const filteredLinks = [];
    filteredNodes.forEach(n => {
        if (n.id !== ME_ID) {
            filteredLinks.push({ source: ME_ID, target: n.id });
        }
    });

    globalNodes = filteredNodes;
    globalLinks = filteredLinks;

    if (simulation) {
        simulation.nodes(globalNodes);
        simulation.force('link').links(globalLinks);
        simulation.alpha(1).restart();
    }

    updateLayout();
    updateFilteredNodesList();
}

// --- FILTERED NODES LIST ---
function updateFilteredNodesList() {
    const listContainer = document.getElementById('filtered-nodes-list');
    if (!listContainer) return;

    // Get filtered nodes (excluding ME)
    const filteredNodes = globalNodes.filter(n => n.id !== 'ME');

    // Update header count
    const header = listContainer.parentElement.querySelector('h3');
    if (header) {
        header.textContent = `Filtered Connections (${filteredNodes.length})`;
    }

    if (filteredNodes.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #666; font-size: 12px;">No filtered nodes</p>';
        return;
    }

    // Sort by name
    const sortedNodes = [...filteredNodes].sort((a, b) => a.name.localeCompare(b.name));

    let html = '<div style="max-height: 300px; overflow-y: auto;">';
    sortedNodes.forEach(node => {
        const isSelected = selectedNode && selectedNode.id === node.id;
        html += `
            <div class="filtered-node-item" data-node-id="${node.id}" style="padding: 8px; margin-bottom: 5px; background: ${isSelected ? '#d0e8ff' : '#f0f0f0'}; border-radius: 4px; cursor: pointer; transition: background 0.2s; border: ${isSelected ? '2px solid #0077b5' : 'none'};"
                 onmouseover="if (!this.classList.contains('selected')) this.style.background='#e0e0e0'"
                 onmouseout="if (!this.classList.contains('selected')) this.style.background='#f0f0f0'"
                 onclick="selectNodeFromList('${node.id}')">
                <strong style="color: #0077b5; font-size: 13px;">${node.name}</strong><br>
                <small style="color: #666; font-size: 11px;">${node.role} at ${node.company}</small>
            </div>
        `;
    });
    html += '</div>';

    listContainer.innerHTML = html;
}

window.selectNodeFromList = function(nodeId) {
    const node = globalNodes.find(n => n.id === nodeId);
    if (!node) return;

    selectedNode = node;
    updateSidebarForPerson(node);

    // Highlight selected node in visualization
    if (g) {
        g.selectAll('.node circle')
            .style('stroke-width', d => d.id === nodeId ? 4 : 1.5)
            .style('stroke', d => d.id === nodeId ? '#00ff88' : '#fff');
    }

    // Highlight selected item in list
    document.querySelectorAll('.filtered-node-item').forEach(item => {
        if (item.dataset.nodeId === nodeId) {
            item.style.background = '#d0e8ff';
            item.style.border = '2px solid #0077b5';
            item.classList.add('selected');
        } else {
            item.style.background = '#f0f0f0';
            item.style.border = 'none';
            item.classList.remove('selected');
        }
    });
};

// --- AI FUNCTIONS ---
function updateSidebarForPerson(node) {
    if (node.id === 'ME') return;

    const panel = document.getElementById('gemini-analysis');
    panel.innerHTML = `
        <strong>${node.name}</strong><br>
        ${node.role}<br>
        ${node.company}<br>
        <small>Connected: ${node.connectedDate.toLocaleDateString()}</small>
    `;

    const actions = document.getElementById('person-actions');
    const linkBtn = document.getElementById('linkedin-link');
    const analyzeBtn = document.getElementById('analyze-person-btn');

    actions.style.display = 'block';

    if (node.url) {
        linkBtn.href = node.url;
        linkBtn.style.display = 'block';
        linkBtn.innerText = "🔗 View LinkedIn Profile";
    } else {
        linkBtn.style.display = 'none';
    }

    analyzeBtn.onclick = () => fetchAIAnalysis(node);
}

async function fetchAIAnalysis(node) {
  const panel = document.getElementById('gemini-analysis');
  panel.innerText = `Analyzing ${node.name}...`;

  const PROMPT = `Role: ${node.role}. Company: ${node.company}. 3 short conversation starters for a dev. JSON: {"analysis": "..."}`;

  try {
    const jsonStr = await aiService.generateContent(PROMPT);
    let result;
    try {
        result = JSON.parse(jsonStr);
    } catch {
        const cleanJson = jsonStr.replace(/```json|```/g, '');
        result = JSON.parse(cleanJson);
    }

    panel.innerHTML = result.analysis.replace(/\n/g, '<br>') || result.explanation || "No analysis.";
  } catch (error) {
    console.error(error);
    if (error.message.includes('429')) {
        panel.innerHTML = "<strong>❄️ AI Cooling Down...</strong><br>Free tier rate limit hit. Please wait 30s.";
    } else {
        panel.innerText = "Error: " + error.message;
    }
  }
}

async function askAINetworkQuery() {
    const query = document.getElementById('ai-query').value;
    if (!query) return;

    const loading = document.getElementById('loading-indicator');
    const panel = document.getElementById('gemini-analysis');

    const provider = document.getElementById('ai-provider').value;
    const userKey = document.getElementById('api-key-input').value;

    if (userKey) aiService.setProvider(provider, userKey);
    else aiService.setProvider(provider);

    loading.style.display = 'block';

    // Get year filter value
    const yearFilter = document.getElementById('year-filter').value;

    // Build network context - respect year filter if set
    let nodesForAI = globalNodes.filter(n => n.id !== 'ME');
    if (yearFilter !== 'all') {
        const targetYear = parseInt(yearFilter);
        nodesForAI = nodesForAI.filter(n => n.connectedDate.getFullYear() === targetYear);
    }

    const simplifiedNetwork = nodesForAI
        .map(n => `- ${n.name} (${n.role} at ${n.company}) [${n.connectedDate.toDateString()}] [ID: ${n.id}]`)
        .join('\n');

    const myContext = `
    My Profile:
    Headline: ${userProfile.headline || "Unknown"}
    Summary: ${userProfile.summary || "Unknown"}
    Industry: ${userProfile.industry || "Unknown"}
    `;

    const PROMPT = `
    You are an AI Network Navigator.

    ${myContext}

    Network:
    ${simplifiedNetwork}

    Query: "${query}"

    Task:
    1. Analyze my profile against the network connections.
    2. Identify people matching the query and how they complement ME.
    3. Score their relevance (0-100).
    4. Provide specific reasoning based on:
       - Complementary Skills (e.g. Dev + Designer)
       - Cultural/Team Fit (Similar roles/companies)
       - Strategic Position (Good match for company)

    Return JSON ONLY.

    Format:
    {
        "explanation": "High-level summary...",
        "matches": [
            {
                "id": "p_1",
                "name": "Name",
                "score": 95,
                "reason": "Complementary: They are a Designer which fits your Dev background...",
                "aspect": "Co-founder Fit / Team Culture / Strategic"
            }
        ]
    }
    `;

    try {
        const jsonStr = await aiService.generateContent(PROMPT);
        let result;
        try {
            result = JSON.parse(jsonStr);
        } catch {
            const cleanJson = jsonStr.replace(/```json|```/g, '');
            result = JSON.parse(cleanJson);
        }

        lastAIResult = result;
        localStorage.setItem('ai_analysis', JSON.stringify(result));

        // Save to history
        const history = JSON.parse(localStorage.getItem('ai_analysis_history') || '[]');
        history.push({
            id: Date.now().toString(),
            query: query,
            timestamp: new Date().toISOString(),
            result: result
        });
        localStorage.setItem('ai_analysis_history', JSON.stringify(history));

        document.getElementById('view-results-btn').style.display = 'block';
        showAIResultsPanel();

        // Filter nodes and connections to only show matches
        const ME_ID = 'ME';
        const matchedIds = new Set(result.matches.map(m => m.id));
        matchedIds.add(ME_ID); // Always include ME node

        // Filter nodes to only include ME and matched nodes
        const filteredNodes = masterNodes.filter(n => matchedIds.has(n.id));

        // Filter links to only include connections to matched nodes
        const filteredLinks = [];
        filteredNodes.forEach(n => {
            if (n.id !== ME_ID) {
                filteredLinks.push({ source: ME_ID, target: n.id });
            }
        });

        globalNodes = filteredNodes;
        globalLinks = filteredLinks;

        // Update simulation with filtered data
        if (simulation) {
            simulation.nodes(globalNodes);
            simulation.force('link').links(globalLinks);
            simulation.alpha(1).restart();
        }

        // Re-render visualization with filtered data
        updateLayout();

        // Update filtered nodes list
        updateFilteredNodesList();

        // Highlight matches
        const matchMap = new Map(result.matches.map(m => [m.id, m]));
        setTimeout(() => {
            if (g) {
                g.selectAll('.node circle')
                    .style('fill', d => {
                        if (d.id === 'ME') return '#fff';
                        if (matchMap.has(d.id)) return '#00ff88';
                        const year = d.connectedDate.getFullYear();
                        const hue = (year % 10) * 36;
                        return d3.hsl(hue, 0.7, 0.6).toString();
                    })
                    .attr('r', d => {
                        if (d.id === 'ME') return 15;
                        if (matchMap.has(d.id)) {
                            const score = matchMap.get(d.id).score;
                            return NODE_RADIUS_MIN + (score / 100) * (NODE_RADIUS_MAX - NODE_RADIUS_MIN) + 5;
                        }
                        const dates = globalNodes.filter(n => n.id !== 'ME').map(n => n.connectedDate.getTime());
                        const minTime = Math.min(...dates);
                        const maxTime = Math.max(...dates);
                        const timeSpan = maxTime - minTime || 1;
                        const recency = (d.connectedDate.getTime() - minTime) / timeSpan;
                        return NODE_RADIUS_MIN + (recency * (NODE_RADIUS_MAX - NODE_RADIUS_MIN));
                    });
            }
        }, 100);

        panel.innerHTML = `<strong>AI Results:</strong><br>${result.explanation}`;

    } catch (e) {
        panel.innerText = "Error: " + e.message;
    } finally {
        loading.style.display = 'none';
    }
}

function downloadAIResults() {
    if (!lastAIResult) return;
    const dataStr = JSON.stringify(lastAIResult, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_network_analysis_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function clearAIResults() {
    localStorage.removeItem('ai_analysis');
    lastAIResult = null;

    document.getElementById('download-results-btn').style.display = 'none';
    document.getElementById('clear-results-btn').style.display = 'none';
    document.getElementById('view-results-btn').style.display = 'none';
    document.getElementById('gemini-analysis').innerHTML = `
      <strong>Hackathon Mode:</strong><br>
      Ask AI to find people, analyze clusters, or suggest career paths.<br><br>
      Try: <em>"Who works in gaming?"</em> or <em>"Find me investors."</em>
    `;

    // Restore all nodes and connections
    const ME_ID = 'ME';
    globalNodes = [...masterNodes];

    // Rebuild all links
    globalLinks = [];
    globalNodes.forEach(n => {
        if (n.id !== ME_ID) {
            globalLinks.push({ source: ME_ID, target: n.id });
        }
    });

    // Update simulation with restored data
    if (simulation) {
        simulation.nodes(globalNodes);
        simulation.force('link').links(globalLinks);
        simulation.alpha(1).restart();
    }

    // Re-render visualization
    updateLayout();

    // Update filtered nodes list
    updateFilteredNodesList();

    // Reset visualization styling
    setTimeout(() => {
        if (g) {
            g.selectAll('.node circle')
                .style('fill', d => {
                    if (d.id === 'ME') return '#fff';
                    const year = d.connectedDate.getFullYear();
                    const hue = (year % 10) * 36;
                    return d3.hsl(hue, 0.7, 0.6).toString();
                })
                .attr('r', d => {
                    if (d.id === 'ME') return 15;
                    const dates = globalNodes.filter(n => n.id !== 'ME').map(n => n.connectedDate.getTime());
                    const minTime = Math.min(...dates);
                    const maxTime = Math.max(...dates);
                    const timeSpan = maxTime - minTime || 1;
                    const recency = (d.connectedDate.getTime() - minTime) / timeSpan;
                    return NODE_RADIUS_MIN + (recency * (NODE_RADIUS_MAX - NODE_RADIUS_MIN));
                });
        }
    }, 100);
}

async function loadUserProfile() {
    try {
        const response = await fetch('./Profile.csv');
        if (!response.ok) return;
        const text = await response.text();
        const data = d3.csvParse(text);

        if (data && data.length > 0) {
            const me = data[0];
            userProfile = {
                firstName: me['First Name'],
                lastName: me['Last Name'],
                headline: me['Headline'],
                summary: me['Summary'],
                industry: me['Industry']
            };
        }
    } catch (e) {
        console.warn("Could not load Profile.csv", e);
    }
}

function restoreAIResults() {
    const savedAnalysis = localStorage.getItem('ai_analysis');
    if (savedAnalysis) {
        try {
            const result = JSON.parse(savedAnalysis);
            lastAIResult = result;
            const viewBtn = document.getElementById('view-results-btn');
            if (viewBtn) viewBtn.style.display = 'block';
        } catch (e) {
            console.error("Failed to restore analysis", e);
        }
    }
}

function showAIResultsPanel() {
    if (!lastAIResult) return;
    const panel = document.getElementById('gemini-analysis');
    panel.innerHTML = `<strong>AI Results:</strong><br>${lastAIResult.explanation}`;
    document.getElementById('download-results-btn').style.display = 'inline-block';
    document.getElementById('clear-results-btn').style.display = 'inline-block';
}

function showResultsList() {
    const modal = document.getElementById('results-modal');
    const listContainer = document.getElementById('results-list');

    let savedResults = [];
    try {
        const history = localStorage.getItem('ai_analysis_history');
        if (history) savedResults = JSON.parse(history);
    } catch (e) {
        console.error("Failed to load history", e);
    }

    if (savedResults.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #666;">No saved results yet.</p>';
        modal.style.display = 'block';
        return;
    }

    savedResults.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let html = '';
    savedResults.forEach((item) => {
        const date = new Date(item.timestamp);
        const dateStr = date.toLocaleString();
        const preview = item.result.explanation ? item.result.explanation.substring(0, 100) + '...' : 'No explanation';
        const matchCount = item.result.matches ? item.result.matches.length : 0;

        html += `
            <div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; background: #f9f9f9;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div style="flex: 1;">
                        <strong style="color: #0077b5; font-size: 16px;">Query:</strong>
                        <p style="margin: 5px 0; font-weight: bold;">"${item.query}"</p>
                        <small style="color: #666;">${dateStr} • ${matchCount} matches</small>
                    </div>
                </div>
                <p style="color: #555; font-size: 14px; margin: 10px 0;">${preview}</p>
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <button onclick="viewResult('${item.id}')" style="flex: 1; padding: 8px; background: #0077b5; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        View
                    </button>
                    <button onclick="downloadResult('${item.id}')" style="flex: 1; padding: 8px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        Download
                    </button>
                    <button onclick="deleteResult('${item.id}')" style="flex: 1; padding: 8px; background: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        Delete
                    </button>
                </div>
            </div>
        `;
    });

    listContainer.innerHTML = html;
    modal.style.display = 'block';
}

window.viewResult = function(resultId) {
    const history = JSON.parse(localStorage.getItem('ai_analysis_history') || '[]');
    const item = history.find(r => r.id === resultId);
    if (!item) return;
    lastAIResult = item.result;
    showAIResultsPanel();
    document.getElementById('results-modal').style.display = 'none';

    // Filter nodes and connections to only show matches
    const ME_ID = 'ME';
    const matchedIds = new Set(item.result.matches.map(m => m.id));
    matchedIds.add(ME_ID); // Always include ME node

    // Filter nodes to only include ME and matched nodes
    const filteredNodes = masterNodes.filter(n => matchedIds.has(n.id));

    // Filter links to only include connections to matched nodes
    const filteredLinks = [];
    filteredNodes.forEach(n => {
        if (n.id !== ME_ID) {
            filteredLinks.push({ source: ME_ID, target: n.id });
        }
    });

    globalNodes = filteredNodes;
    globalLinks = filteredLinks;

    // Update simulation with filtered data
    if (simulation) {
        simulation.nodes(globalNodes);
        simulation.force('link').links(globalLinks);
        simulation.alpha(1).restart();
    }

    // Re-render visualization with filtered data
    updateLayout();

    // Update filtered nodes list
    updateFilteredNodesList();

    // Highlight matches
    const matchMap = new Map(item.result.matches.map(m => [m.id, m]));
    setTimeout(() => {
        if (g) {
            g.selectAll('.node circle')
                .style('fill', d => {
                    if (d.id === 'ME') return '#fff';
                    if (matchMap.has(d.id)) return '#00ff88';
                    const year = d.connectedDate.getFullYear();
                    const hue = (year % 10) * 36;
                    return d3.hsl(hue, 0.7, 0.6).toString();
                })
                .attr('r', d => {
                    if (d.id === 'ME') return 15;
                    if (matchMap.has(d.id)) {
                        const score = matchMap.get(d.id).score;
                        return NODE_RADIUS_MIN + (score / 100) * (NODE_RADIUS_MAX - NODE_RADIUS_MIN) + 5;
                    }
                    const dates = globalNodes.filter(n => n.id !== 'ME').map(n => n.connectedDate.getTime());
                    const minTime = Math.min(...dates);
                    const maxTime = Math.max(...dates);
                    const timeSpan = maxTime - minTime || 1;
                    const recency = (d.connectedDate.getTime() - minTime) / timeSpan;
                    return NODE_RADIUS_MIN + (recency * (NODE_RADIUS_MAX - NODE_RADIUS_MIN));
                });
        }
    }, 100);

    // Update filtered nodes list
    updateFilteredNodesList();
};

window.downloadResult = function(resultId) {
    const history = JSON.parse(localStorage.getItem('ai_analysis_history') || '[]');
    const item = history.find(r => r.id === resultId);
    if (!item) return;
    const dataStr = JSON.stringify({
        query: item.query,
        timestamp: item.timestamp,
        result: item.result
    }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_search_${item.query.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}_${new Date(item.timestamp).toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.deleteResult = function(resultId) {
    if (!confirm('Delete this search result?')) return;
    let history = JSON.parse(localStorage.getItem('ai_analysis_history') || '[]');
    history = history.filter(r => r.id !== resultId);
    localStorage.setItem('ai_analysis_history', JSON.stringify(history));

    // Hide button if no results left
    if (history.length === 0) {
        document.getElementById('view-results-btn').style.display = 'none';
    }

    showResultsList();
};

// --- INIT ---
async function initGraph() {
  await loadUserProfile();

  const response = await fetch('./Connections.csv');
  const text = await response.text();

  const startIdx = text.indexOf("First Name");
  const data = d3.csvParse(text.substring(startIdx));

  const nodes = [];
  const links = [];
  const ME_ID = 'ME';

  nodes.push({ id: ME_ID, name: "Me", role: "Owner", company: "My Network", connectedDate: new Date() });

  data.forEach((row, index) => {
      if (!row['First Name']) return;

      nodes.push({
          id: `p_${index}`,
          name: `${row['First Name']} ${row['Last Name']}`,
          role: row['Position'],
          company: row['Company'],
          url: row['URL'],
          connectedDate: parseConnectionDate(row['Connected On'])
      });

      links.push({ source: ME_ID, target: `p_${index}` });
  });

  masterNodes = nodes;
  globalNodes = [...nodes];
  globalLinks = [...links];

  populateYearFilter(masterNodes);

  initVisualization();

  setTimeout(() => {
      updateLayout();
      restoreAIResults();
      updateFilteredNodesList();
  }, 100);

  // Listeners
  document.getElementById('rearrange-btn').addEventListener('click', updateLayout);
  document.getElementById('layout-mode').addEventListener('change', updateLayout);
  document.getElementById('year-filter').addEventListener('change', applyYearFilter);
  document.getElementById('ai-ask-btn').addEventListener('click', askAINetworkQuery);
  document.getElementById('download-results-btn').addEventListener('click', downloadAIResults);
  document.getElementById('clear-results-btn').addEventListener('click', clearAIResults);

  const viewResultsBtn = document.getElementById('view-results-btn');
  if (viewResultsBtn) viewResultsBtn.addEventListener('click', showResultsList);

  const closeModalBtn = document.getElementById('close-results-modal');
  if (closeModalBtn) closeModalBtn.addEventListener('click', () => {
      document.getElementById('results-modal').style.display = 'none';
  });

  // Handle window resize
  window.addEventListener('resize', () => {
      if (svg) {
          svg.attr('width', window.innerWidth).attr('height', window.innerHeight);
          updateLayout();
      }
  });
}

initGraph();
