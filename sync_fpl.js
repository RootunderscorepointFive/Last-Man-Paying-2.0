const fs = require('fs');
const xlsx = require('xlsx');
const path = require('path');

const LEAGUE_ID = '680132';
const DATA_FILE = 'fpl_data.json';

// Find the latest Excel file
const files = fs.readdirSync('.');
const excelFile = files
    .filter(f => f.startsWith('FPL 2025 updated for GW') && f.endsWith('.xlsx'))
    .sort((a, b) => {
        const gwA = parseInt(a.match(/GW(\d+)/)?.[1] || 0);
        const gwB = parseInt(b.match(/GW(\d+)/)?.[1] || 0);
        return gwB - gwA;
    })[0];

if (!excelFile) {
    console.error('No matching Excel file found (FPL 2025 updated for GW*.xlsx)');
    process.exit(1);
}

const EXCEL_FILE = excelFile;
console.log(`Using Excel file: ${EXCEL_FILE}`);

async function fetchJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    return response.json();
}

function parseExcel() {
    console.log(`Reading Excel file: ${EXCEL_FILE}...`);
    const wb = xlsx.readFile(EXCEL_FILE);
    
    // Parse Budget for Owed/Fines
    const budgetSheet = wb.Sheets['Budget'];
    const budgetData = xlsx.utils.sheet_to_json(budgetSheet);
    
    // Parse Funds Received for Monthly totals
    const fundsSheet = wb.Sheets['Funds Received'];
    const fundsData = xlsx.utils.sheet_to_json(fundsSheet);

    // Parse Roster for official Bottom 3 counts
    const rosterSheet = wb.Sheets['Roster'];
    const rosterData = xlsx.utils.sheet_to_json(rosterSheet);

    const excelManagers = {};

    // Map monthly columns based on the header row in Funds Received
    const monthMap = {
        '__EMPTY_1': 'Sep',
        '__EMPTY_2': 'Oct',
        '__EMPTY_3': 'Nov',
        '__EMPTY_4': 'Dec',
        '__EMPTY_5': 'Jan',
        '__EMPTY_6': 'Feb',
        '__EMPTY_7': 'Mar',
        '__EMPTY_8': 'Apr',
        '__EMPTY_9': 'May',
        'August ': 'Aug'
    };

    const monthlyTotals = { Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0, Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0 };

    fundsData.forEach(row => {
        if (row.Team && row.Team !== 'Team') {
            Object.keys(monthMap).forEach(key => {
                if (row[key]) {
                    monthlyTotals[monthMap[key]] += Number(row[key]);
                }
            });
        }
    });

    budgetData.forEach(row => {
        const name = row['__EMPTY_1'];
        if (name && name !== 'Loser') {
            const normalizedName = name.replace(/\s+/g, ' ').trim();
            excelManagers[normalizedName] = {
                base: Number(row['__EMPTY_2'] || 0),
                fines: Number(row['__EMPTY_3'] || 0) + Number(row['__EMPTY_4'] || 0) + Number(row['__EMPTY_5'] || 0),
                paid: Number(row['__EMPTY_7'] || 0),
                apps: 0 // Default, will be updated from Roster
            };
        }
    });

    rosterData.forEach(row => {
        const name = row['__EMPTY_2'];
        if (name && name !== 'Team') {
            const normalizedName = name.replace(/\s+/g, ' ').trim();
            if (excelManagers[normalizedName]) {
                excelManagers[normalizedName].apps = Number(row['__EMPTY_8'] || 0);
            }
        }
    });

    return { excelManagers, monthlyTotals };
}

async function sync() {
    const { excelManagers, monthlyTotals } = parseExcel();
    console.log(`Syncing League ${LEAGUE_ID} from FPL API...`);

    // Fetch League Standings
    const leagueData = await fetchJSON(`https://fantasy.premierleague.com/api/leagues-classic/${LEAGUE_ID}/standings/`);
    const managers = leagueData.standings.results;
    
    const bootstrap = await fetchJSON('https://fantasy.premierleague.com/api/bootstrap-static/');
    const currentGW = bootstrap.events.find(e => e.is_current).id;

    const gwData = [];
    const runInData = [];
    const standings = [];
    const lmpData = [];

    const COLORS = ['#e63946','#f4845f','#4dabf7','#b197fc','#ff6b9d','#38d9a9','#9775fa','#339af0','#ff8c42','#74c0fc','#ffa94d','#5c7cfa','#c9f542','#da77f2','#63e6be','#ffe066','#ff6b6b'];

    for (let i = 0; i < managers.length; i++) {
        const m = managers[i];
        const history = await fetchJSON(`https://fantasy.premierleague.com/api/entry/${m.entry}/history/`);
        const pastGWs = history.current.filter(h => h.event <= currentGW);
        const gwPts = pastGWs.map(h => h.points - h.event_transfers_cost);
        const gwHits = pastGWs.map(h => h.event_transfers_cost);
        
        gwData.push({
            team: m.entry_name,
            manager: m.player_name,
            entry: m.entry,
            gwPts: gwPts,
            gwHits: gwHits,
            chips: history.chips,
            total: m.total
        });
    }
// League ranks per GW (Cumulative for Run-In Chart)
const numGWs = gwData[0].gwPts.length;
for (let g = 0; g < numGWs; g++) {
    // Cumulative rank
    const cumStandings = gwData.map(m => ({
        entry: m.entry,
        cumPts: m.gwPts.slice(0, g + 1).reduce((a, b) => a + b, 0)
    })).sort((a, b) => b.cumPts - a.cumPts);

    cumStandings.forEach((s, index) => {
        const m = gwData.find(d => d.entry === s.entry);
        if (!m.gwRanks) m.gwRanks = [];
        m.gwRanks[g] = index + 1;
    });

    // Weekly rank (for heat maps, etc.)
    const weeklySortedDesc = gwData.map(m => ({
        entry: m.entry,
        gwPt: m.gwPts[g],
        totalPts: m.gwPts.slice(0, g + 1).reduce((a, b) => a + b, 0)
    })).sort((a, b) => b.gwPt - a.gwPt || b.totalPts - a.totalPts);
    
    weeklySortedDesc.forEach((s, index) => {
        const m = gwData.find(d => d.entry === s.entry);
        if (!m.weeklyRanks) m.weeklyRanks = [];
        m.weeklyRanks[g] = index + 1;
    });
}

gwData.forEach((m, i) => {
    // Use the official count from Excel (excelManagers) instead of calculation
    const normalizedS = m.manager.replace(/\s+/g, ' ').trim();
    const ex = excelManagers[normalizedS] || { apps: 0 };
    const bottomApps = ex.apps;

        standings.push({ manager: m.manager, team: m.team, pts: m.total, bottomApps: bottomApps });
        lmpData.push({ manager: m.manager, team: m.team, apps: bottomApps, fines: 250 + (bottomApps * 100) });
        runInData.push({ f: m.manager, s: m.manager.split(' ')[0], t: m.team, r: m.gwRanks, c: COLORS[i % COLORS.length] });
    });

    const payments = standings.map(s => {
        const normalizedS = s.manager.replace(/\s+/g, ' ').trim();
        const ex = excelManagers[normalizedS] || { base: 0, fines: 0, paid: 0 };
        return {
            manager: s.manager,
            team: s.team,
            base: ex.base,
            fines: ex.fines,
            owed: ex.base + ex.fines,
            paid: ex.paid
        };
    });


    const newData = {
        MAX_GW: currentGW,
        standings: standings.sort((a, b) => b.pts - a.pts),
        payments: payments,
        monthly: monthlyTotals,
        lmpData: lmpData.sort((a, b) => b.apps - a.apps),
        gwData: gwData,
        runInData: runInData
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2));
    console.log('Sync complete! fpl_data.json updated with Live API Points and Excel Payments.');
}

sync().catch(console.error);

