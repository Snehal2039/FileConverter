// Global state
let currentFile = null;
let parsedData = [];

// DOM elements
const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const resultsSection = document.getElementById('resultsSection');
const convertingMsg = document.getElementById('convertingMsg');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');
const recordCount = document.getElementById('recordCount');
const fileName = document.getElementById('fileName');
const dataTable = document.getElementById('dataTable');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');

/**
 * Parse binary file using the exact struct layout
 * 
 * Binary record layout (88 bytes per record):
 * [0]      day          uint8
 * [1]      month        uint8
 * [2:4]    year         uint16 LE
 * [4]      hour         uint8
 * [5]      minute       uint8
 * [6:17]   patient_id   char[11]  (10 chars + null)
 * [17:48]  patient_name char[31]  (null + name + null-pad)
 * [48:59]  dialyzer_id  char[11]  (10 chars + null)
 * [59:60]  null
 * [60:64]  volume       int32 LE
 * [64]     prs          uint8     (0xFF=P, 0x00=F)
 * [65:88]  padding      23 bytes
 */
async function parseBinaryFile(file) {
    convertingMsg.classList.remove('hidden');
    errorMsg.classList.add('hidden');

    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        const records = [];
        const recordSize = 88;
        const numRecords = Math.floor(buffer.byteLength / recordSize);

        for (let i = 0; i < numRecords; i++) {
            const offset = i * recordSize;

            // Extract date/time (binary packed: day, month, year, hour, minute)
            const day = view.getUint8(offset + 0);
            const month = view.getUint8(offset + 1);
            const year = view.getUint16(offset + 2, true); // little-endian
            const hour = view.getUint8(offset + 4);
            const minute = view.getUint8(offset + 5);

            const date = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

            // Helper function to extract null-terminated strings
            const extractString = (start, length) => {
                const bytes = new Uint8Array(buffer, offset + start, length);
                let str = '';
                for (let j = 0; j < bytes.length; j++) {
                    if (bytes[j] === 0) break;
                    str += String.fromCharCode(bytes[j]);
                }
                return str.trim();
            };

            // patient_id at [6:17] - strip leading nulls
            const patientIdBytes = new Uint8Array(buffer, offset + 6, 11);
            let pidStart = 0;
            while (pidStart < patientIdBytes.length && patientIdBytes[pidStart] === 0) {
                pidStart++;
            }
            const patientId = extractString(6 + pidStart, 11 - pidStart);

            // patient_name at [17:48] - strip leading nulls
            const nameBytes = new Uint8Array(buffer, offset + 17, 31);
            let nameStart = 0;
            while (nameStart < nameBytes.length && nameBytes[nameStart] === 0) {
                nameStart++;
            }
            const patientName = extractString(17 + nameStart, 31 - nameStart);

            // dialyzer_id at [48:59]
            const dialyzerId = extractString(48, 11);

            // volume at [60:64] - int32 little-endian
            const volume = view.getInt32(offset + 60, true);

            // prs at [64] - 0xFF = P, 0x00 = F
            const prsFlag = view.getUint8(offset + 64);
            const prs = prsFlag === 0xFF ? 'P' : 'F';

            records.push({
                date,
                time,
                patientId,
                patientName,
                dialyzerId,
                volume,
                prs
            });
        }

        parsedData = records;
        displayResults(records, file.name);
    } catch (err) {
        showError(`Failed to parse file: ${err.message}`);
    } finally {
        convertingMsg.classList.add('hidden');
    }
}

/**
 * Display parsed data in the results section
 */
function displayResults(data, filename) {
    currentFile = filename;

    // Update stats
    recordCount.textContent = data.length;
    fileName.textContent = filename;

    // Populate table
    dataTable.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${row.time}</td>
            <td class="patient-id">${row.patientId}</td>
            <td class="patient-name">${row.patientName}</td>
            <td>${row.dialyzerId}</td>
            <td class="volume">${row.volume}</td>
            <td>
                <span class="prs-badge ${row.prs === 'P' ? 'pass' : 'fail'}">
                    ${row.prs === 'P' ?
                        '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' :
                        '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
                    }
                    ${row.prs}
                </span>
            </td>
        `;
        dataTable.appendChild(tr);
    });

    // Show results section
    uploadSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
}

/**
 * Download parsed data as CSV
 */
function downloadCSV() {
    if (parsedData.length === 0) return;

    const headers = ['date', 'time', 'patient_id', 'patient_name', 'dialyzer_id', 'volume', 'prs'];
    const rows = parsedData.map(row => [
        row.date,
        row.time,
        row.patientId,
        row.patientName,
        row.dialyzerId,
        row.volume,
        row.prs
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${currentFile.replace(/\.[^/.]+$/, '')}_converted.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Reset the application to initial state
 */
function reset() {
    currentFile = null;
    parsedData = [];
    fileInput.value = '';
    resultsSection.classList.add('hidden');
    uploadSection.classList.remove('hidden');
    errorMsg.classList.add('hidden');
}

/**
 * Show error message
 */
function showError(message) {
    errorText.textContent = message;
    errorMsg.classList.remove('hidden');
}

// Event listeners
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        parseBinaryFile(file);
    }
});

downloadBtn.addEventListener('click', downloadCSV);
resetBtn.addEventListener('click', reset);