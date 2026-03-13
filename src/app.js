// Leaflet, Chart, mathjs und FitFileParser kommen global aus den CDN-Skripten in index.html

// Chart.js UMD exportiert "Chart" im globalen Namespace
const { Chart, LineController, LineElement, PointElement, LinearScale, Title, Tooltip, Legend, CategoryScale, Filler } = window.Chart;

// mathjs liegt global als "math" vor (durch das CDN-Skript)
// FitFileParser liegt global als "FitFileParser" vor

// Wichtig: Chart.js Controller und Skalen registrieren
Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    Title,
    Tooltip,
    Legend,
    CategoryScale,
    Filler
);



// Globale Variablen
let map;
let polylineA, polylineB;
let markerA, markerB;
let processedDataA = null;
let processedDataB = null;
let altitudeChartInstance = null;
let throttleTimeout = null;
const THROTTLE_DELAY = 100; // Millisekunden, z.B. 10 Updates pro Sekunde maximal
let mode = 'single'; // 'single' oder 'compare'
let modeRadios;
let rangePanelElem;



// DOM Elemente (werden im DOMContentLoaded zugewiesen)
let fitFileAInput, fitFileBInput, timeSlider, loader, similarityWarning, mapElement;
let sliderTimeMinElem, sliderTimeMaxElem, currentTimeDisplayElem;
let timeAElem, timeBElem, hrAElem, hrBElem, speedAElem, speedBElem;
let powerAElem, powerBElem, avgPowerAElem, avgPowerBElem;
let altitudeAElem, altitudeBElem, ascentAElem, ascentBElem, descentAElem, descentBElem;
let rangeStartSlider, rangeEndSlider;
let rangeStartLabel, rangeEndLabel;
let rangeHrAElem, rangeDistanceAElem, rangePowerAElem, rangeAscentAElem, rangeSpeedAElem;
let rangeMaxPowerDurationsAElem;
let rangeBarFill;
let rangeDescentAElem;
let rangeDurationAElem;




const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw: (chart, args, options) => {
        // Sicherer Zugriff auf Tooltip-Status
        // const tooltipActive = chart.tooltip && chart.tooltip.getActiveElements && chart.tooltip.getActiveElements().length > 0;
        // Die obige Zeile ist für Chart.js v3 oft besser.
        // Für den Moment lassen wir die Tooltip-Prüfung weg, um den Fehler zu umgehen,
        // da die Linie unabhängig vom Tooltip gezeichnet werden soll.

        const sliderValue = options.sliderValue;
        const xAxisType = options.xAxisType;

        if (sliderValue === undefined || xAxisType === undefined || sliderValue === null) { // Auch auf null prüfen
            // console.warn("verticalLinePlugin: sliderValue oder xAxisType nicht definiert oder null.");
            return;
        }

        let currentXValue = sliderValue; // Der sliderValue ist bereits der korrekte x-Achsenwert für die Linie

        if (currentXValue === null || currentXValue === undefined) {
            // console.warn("verticalLinePlugin: currentXValue ist null oder undefined.");
            return;
        }

        let xPosition;
        try {
            xPosition = chart.scales.x.getPixelForValue(currentXValue);
        } catch (e) {
            console.error("Fehler beim Ermitteln der xPosition für die vertikale Linie:", e, "currentXValue:", currentXValue);
            return;
        }


        if (xPosition === undefined || isNaN(xPosition)) { // Auch auf NaN prüfen
            // console.warn(`verticalLinePlugin: xPosition ist undefined oder NaN für currentXValue ${currentXValue}. Wert könnte außerhalb der Skala liegen.`);
            return;
        }

        const yScale = chart.scales.y;
        const ctx = chart.ctx;

        // Linie zeichnen
        ctx.save(); // Zustand speichern
        ctx.beginPath();
        ctx.moveTo(xPosition, yScale.top);
        ctx.lineTo(xPosition, yScale.bottom);
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#888';
        ctx.stroke();
        ctx.restore(); // Zustand wiederherstellen
    }
};

function applyModeToUI() {
    const fitFileBLabel   = document.querySelector('label[for="fitFileB"]');
    const fitFileBInput   = document.getElementById('fitFileB');
    const fileBContainer  = document.getElementById('fileBContainer');
    const trackBHeader    = document.querySelector('th.track-b');
    const trackBCells     = document.querySelectorAll(
        'td#timeB, td#distanceB, td#hrB, td#speedB, td#altitudeB, td#ascentB, td#descentB, td#powerB, td#avgPowerB'
    );

    const rangeControls = document.getElementById('rangeControls');

    // ganze Bereichs-ZEILEN (tr), nicht nur Zellen
    const rangeRowElems = [
        document.getElementById('rowRangeDuration'),
        document.getElementById('rowRangeHr'),
        document.getElementById('rowRangeDistance'),
        document.getElementById('rowRangeSpeed'),
        document.getElementById('rowRangePower'),
        document.getElementById('rowRangeAscent'),
        document.getElementById('rowRangeDescent'),
        document.getElementById('rowRangeMaxPower')
    ];

    const perTrackRows = [
        document.getElementById('rowTimeTrack'),
        document.getElementById('rowDistanceTrack'),
        document.getElementById('rowHrTrack'),
        document.getElementById('rowSpeedTrack'),
        document.getElementById('rowAltTrack'),
        document.getElementById('rowAscentTrack'),
        document.getElementById('rowDescentTrack'),
        document.getElementById('rowPowerTrack'),
        document.getElementById('rowAvgPowerTrack')
    ];

    if (mode === 'single') {
        // Datei B und Spalte B ausblenden / deaktivieren
        if (fileBContainer) fileBContainer.classList.add('hidden');
        if (fitFileBLabel)  fitFileBLabel.classList.add('hidden');
        if (fitFileBInput) {
            fitFileBInput.classList.add('hidden');
            fitFileBInput.value = '';
        }
        if (trackBHeader) trackBHeader.classList.add('hidden');
        trackBCells.forEach(td => td.classList.add('hidden'));

        processedDataB = null;
        if (hrBElem)       hrBElem.textContent       = 'N/A';
        if (speedBElem)    speedBElem.textContent    = 'N/A';
        if (powerBElem)    powerBElem.textContent    = 'N/A';
        if (avgPowerBElem) avgPowerBElem.textContent = 'N/A';
        if (altitudeBElem) altitudeBElem.textContent = 'N/A';
        if (ascentBElem)   ascentBElem.textContent   = 'N/A';
        if (descentBElem)  descentBElem.textContent  = 'N/A';
        const distanceBElem = document.getElementById('distanceB');
        if (distanceBElem) distanceBElem.textContent = 'N/A';

        if (similarityWarning) similarityWarning.textContent = '';
        perTrackRows.forEach(row => { if (row) row.classList.add('hidden'); });

        // Bereichsanalyse sichtbar + Slider aktiv
        if (rangeControls) rangeControls.classList.remove('hidden');
        if (rangeStartSlider) rangeStartSlider.disabled = false;
        if (rangeEndSlider)   rangeEndSlider.disabled   = false;

        // Bereichs-ZEILEN einblenden
        rangeRowElems.forEach(tr => {
            if (tr) tr.classList.remove('hidden');
        });

        if (processedDataA) updateRangeStats();
    } else {
        // Vergleichsmodus
        if (fileBContainer) fileBContainer.classList.remove('hidden');
        if (fitFileBLabel)  fitFileBLabel.classList.remove('hidden');
        if (fitFileBInput)  fitFileBInput.classList.remove('hidden');
        if (trackBHeader)   trackBHeader.classList.remove('hidden');
        trackBCells.forEach(td => td.classList.remove('hidden'));
        perTrackRows.forEach(row => { if (row) row.classList.remove('hidden'); });

        // Bereichsanalyse ausblenden + Slider deaktivieren
        if (rangeControls) rangeControls.classList.add('hidden');
        if (rangeStartSlider) rangeStartSlider.disabled = true;
        if (rangeEndSlider)   rangeEndSlider.disabled   = true;

        // Bereichswerte leeren
        if (rangeDurationAElem)        rangeDurationAElem.textContent        = 'N/A';
        if (rangeHrAElem)              rangeHrAElem.textContent              = 'N/A';
        if (rangeDistanceAElem)        rangeDistanceAElem.textContent        = 'N/A';
        if (rangeSpeedAElem)           rangeSpeedAElem.textContent           = 'N/A';
        if (rangePowerAElem)           rangePowerAElem.textContent           = 'N/A';
        if (rangeAscentAElem)          rangeAscentAElem.textContent          = 'N/A';
        if (rangeDescentAElem)         rangeDescentAElem.textContent         = 'N/A';
        if (rangeMaxPowerDurationsAElem) rangeMaxPowerDurationsAElem.textContent = 'N/A';

        // Bereichs-ZEILEN komplett ausblenden
        rangeRowElems.forEach(tr => {
            if (tr) tr.classList.add('hidden');
        });

        // Bereichs- und Max-Interval-Markierungen im Chart entfernen
        if (altitudeChartInstance) {
            const ds = altitudeChartInstance.data.datasets;
            ['Bereich Start', 'Bereich Ende', 'Max 5min', 'Max 10min', 'Max 20min', 'Max 60min']
                .forEach(label => {
                    const idx = ds.findIndex(d => d.label === label);
                    if (idx !== -1) ds[idx].data = [];
                });
            altitudeChartInstance.update('none');
        }
    }
}



function initMap() {
    if (map) { map.remove(); map = null; }
    mapElement = document.getElementById('map');
    if (!mapElement) { console.error("Karten-DOM-Element ('map') nicht gefunden!"); alert("Kartencontainer nicht gefunden."); return false; }
    try {
        map = L.map(mapElement).setView([51.505, -0.09], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        return true;
    } catch (e) { console.error("Fehler beim Initialisieren der Leaflet-Karte:", e); alert("Fehler Karte. Leaflet geladen?"); return false; }
}

function toRad(degrees) { return degrees * Math.PI / 180; }

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
    lat1 = toRad(lat1); lat2 = toRad(lat2);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function parseFitFile(file, activityId) {
    const backendUrl = 'https://garmin-fit-backend.onrender.com/api/parse-fit';
    // URL an deinen tatsächlichen Render-Service anpassen

    if (!file) {
        throw new Error('Keine Datei übergeben');
    }

    const formData = new FormData();
    formData.append('file', file);

    let response;
    try {
        response = await fetch(backendUrl, {
            method: 'POST',
            body: formData
        });
    } catch (err) {
        console.error('Netzwerk- oder Verbindungsfehler zum Backend:', err);
        throw new Error('Keine Verbindung zum FIT-Backend möglich');
    }

    if (!response.ok) {
        let errMsg = `Backend error: ${response.status}`;
        try {
            const errJson = await response.json();
            if (errJson && errJson.error) {
                errMsg = errJson.error;
            }
        } catch (_) {
            // JSON-Parse-Fehler ignorieren, Standardtext verwenden
        }
        throw new Error(errMsg);
    }

    const data = await response.json();

    // Erwartete Struktur vom Backend:
    // {
    //   records: [...],
    //   startTime,
    //   endTime,
    //   totalDuration,
    //   totalDurationMs,
    //   totalDistance,
    //   totalAscent
    // }

    if (!data || !Array.isArray(data.records) || data.records.length === 0) {
        throw new Error('Backend lieferte keine gültigen FIT-Daten');
    }

    // Direkt zurückgeben; dein bestehender Code arbeitet bereits mit
    // data.records, data.totalDurationMs, data.totalDistance, data.totalAscent usw.
    return {
        records: data.records,
        startTime: data.startTime,
        endTime: data.endTime,
        totalDuration: data.totalDuration,
        totalDurationMs: data.totalDurationMs,
        totalDistance: data.totalDistance,
        totalAscent: data.totalAscent
    };
}



function semicirclesToDegrees(semicircles) {
    if (semicircles === null || semicircles === undefined) return null;
    return semicircles * (180 / Math.pow(2, 31));
}

// In src/app.js

// In src/app.js

// Funktion zum Erstellen/Aktualisieren des Höhendiagramms
// In src/app.js

// Funktion zum Erstellen/Aktualisieren des Höhendiagramms
function setupAltitudeChart() {
    if (!processedDataA && !processedDataB) {
        if (altitudeChartInstance) {
            altitudeChartInstance.destroy();
            altitudeChartInstance = null;
            console.log("Höhendiagramm zerstört, da keine Daten vorhanden.");
        }
        return;
    }

    const datasets = [];
    const commonXAxisType = 'distance'; // Kann 'distance' oder 'relativeTime' sein
    const commonXAxisLabel = commonXAxisType === 'distance' ? 'Distanz (km)' : 'Zeit (s)';

    // Daten für Track A vorbereiten (Höhenlinie)
    if (processedDataA && processedDataA.records.length > 0) {
        const numPointsA = processedDataA.records.length;
        const downsampleFactorA = numPointsA > 1000 ? Math.ceil(numPointsA / 500) : 1;
        datasets.push({
            label: 'Höhe Training A (Blau)',
            data: processedDataA.records
                .filter((p, i) => i % downsampleFactorA === 0)
                .map(p => ({
                    x: commonXAxisType === 'distance' ? p.distance : p.relativeTimestamp / 1000,
                    y: p.altitude
                })),
            borderColor: 'blue',
            backgroundColor: 'rgba(0, 0, 255, 0.05)',
            fill: 'origin',
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 1.5,
            order: 2 // Sorge dafür, dass die Linie im Hintergrund ist
        });
    }

    // Daten für Track B vorbereiten (Höhenlinie)
    if (processedDataB && processedDataB.records.length > 0) {
        const numPointsB = processedDataB.records.length;
        const downsampleFactorB = numPointsB > 1000 ? Math.ceil(numPointsB / 500) : 1;
        datasets.push({
            label: 'Höhe Training B (Rot)',
            data: processedDataB.records
                .filter((p, i) => i % downsampleFactorB === 0)
                .map(p => ({
                    x: commonXAxisType === 'distance' ? p.distance : p.relativeTimestamp / 1000,
                    y: p.altitude
                })),
            borderColor: 'red',
            backgroundColor: 'rgba(255, 0, 0, 0.05)',
            fill: 'origin',
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 1.5,
            order: 2
        });
    }

    // Zusätzliche Datasets für die beweglichen Punkte und ihre Haarlinien
    // Dataset für Position A (Punkt)
    datasets.push({
        label: 'Position A',
        data: [],
        borderColor: 'blue',
        backgroundColor: 'blue',
        pointRadius: 6,
        pointHoverRadius: 8,
        showLine: false,
        order: 0 // Stellt sicher, dass die Punkte über allem gezeichnet werden
    });
    // Dataset für Haarlinie A
    datasets.push({
        label: 'Haarlinie A',
        data: [],
        borderColor: 'rgba(0, 0, 255, 0.5)',
        borderWidth: 1,
        pointRadius: 0,
        showLine: true,
        order: 1 // Über der Fläche, aber unter dem Punkt
    });

    // Dataset für Position B (Punkt)
    datasets.push({
        label: 'Position B',
        data: [],
        borderColor: 'red',
        backgroundColor: 'red',
        pointRadius: 6,
        pointHoverRadius: 8,
        showLine: false,
        order: 0
    });
    // Dataset für Haarlinie B
    datasets.push({
        label: 'Haarlinie B',
        data: [],
        borderColor: 'rgba(255, 0, 0, 0.5)',
        borderWidth: 1,
        pointRadius: 0,
        showLine: true,
        order: 1
    });
    // nach den bestehenden Datasets (Höhe A/B, Position/Haarlinie A/B)
    datasets.push({
        label: 'Max 5min',
        data: [],
        borderColor: 'rgba(0, 128, 255, 0.8)',
        borderWidth: 2,
        pointRadius: 0,
        showLine: true
    });
    datasets.push({
        label: 'Max 10min',
        data: [],
        borderColor: 'rgba(0, 200, 0, 0.8)',
        borderWidth: 2,
        pointRadius: 0,
        showLine: true
    });
    datasets.push({
        label: 'Max 20min',
        data: [],
        borderColor: 'rgba(255, 165, 0, 0.8)',
        borderWidth: 2,
        pointRadius: 0,
        showLine: true
    });
    datasets.push({
        label: 'Max 60min',
        data: [],
        borderColor: 'rgba(255, 0, 0, 0.8)',
        borderWidth: 2,
        pointRadius: 0,
        showLine: true
    });

    // Dataset für Bereichs-Start (vertikale Linie)
    datasets.push({
        label: 'Bereich Start',
        data: [],
        borderColor: 'rgba(46, 204, 113, 0.9)',   // grün
        borderWidth: 1.5,
        pointRadius: 0,
        showLine: true,
        fill: false,
        order: 1
    });

    // Dataset für Bereichs-Ende (vertikale Linie)
    datasets.push({
        label: 'Bereich Ende',
        data: [],
        borderColor: 'rgba(231, 76, 60, 0.9)',     // rot
        borderWidth: 1.5,
        pointRadius: 0,
        showLine: true,
        fill: false,
        order: 1
    });


    if (datasets.length === 0) {
        if (altitudeChartInstance) {
            altitudeChartInstance.destroy();
            altitudeChartInstance = null;
        }
        return;
    }

    const chartData = { datasets: datasets };

    // Finde min und max Höhe über alle Datasets für eine bessere Skalierung
    let minY = null, maxY = null;
    // Nur die ersten beiden Datasets (die Höhenlinien) für die Skalierung berücksichtigen
    datasets.slice(0, 2).forEach(dataset => {
        dataset.data.forEach(point => {
            if (point.y !== null && point.y !== undefined && !isNaN(point.y)) {
                if (minY === null || point.y < minY) minY = point.y;
                if (maxY === null || point.y > maxY) maxY = point.y;
            }
        });
    });

    let yAxisPaddingValue = 20;
    if (minY !== null && maxY !== null) {
        const range = maxY - minY;
        if (range > 0) yAxisPaddingValue = Math.max(10, range * 0.05);
        else yAxisPaddingValue = 10;
    }

    let finalMinY = minY !== null ? Math.floor(minY - yAxisPaddingValue) : 0;
    let finalMaxY = maxY !== null ? Math.ceil(maxY + yAxisPaddingValue) : 400;

    if (finalMinY !== undefined && finalMaxY !== undefined && finalMinY === finalMaxY) {
        finalMinY -= 10;
        finalMaxY += 10;
    }

    const config = {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: commonXAxisLabel },
                    ticks: { autoSkip: true, maxTicksLimit: 20 }
                },
                y: {
                    title: { display: true, text: 'Höhe (m)' },
                    beginAtZero: false,
                    min: finalMinY,
                    max: finalMaxY,
                    ticks: { autoSkip: true, maxTicksLimit: 10 }
                }
            },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: {
                        filter: function (legendItem, chartData) {
                            return legendItem.datasetIndex < 2 && (legendItem.text && legendItem.text.startsWith('Höhe'));
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label.startsWith('Position') || label.startsWith('Haarlinie')) return null; // Verstecke Tooltips für Punkte/Linien
                            if (label) label += ': ';
                            if (context.parsed.y !== null) label += `${context.parsed.y.toFixed(0)} m Höhe`;
                            if (context.parsed.x !== null) label += ` bei ${context.parsed.x.toFixed(2)} ${commonXAxisType === 'distance' ? 'km' : 's'}`;
                            return label;
                        }
                    }
                }
            }
        },
    };

    const canvasElement = document.getElementById('altitudeChart');
    if (!canvasElement) { console.error("Canvas Element 'altitudeChart' nicht gefunden!"); return; }
    const ctx = canvasElement.getContext('2d');

    if (altitudeChartInstance) {
        altitudeChartInstance.destroy();
    }
    altitudeChartInstance = new Chart(ctx, config);
    console.log("Höhendiagramm erfolgreich erstellt/aktualisiert.");
}


function checkAndProcessFiles() {
    console.log("--- Entering checkAndProcessFiles ---");



    // Bestimme, welche Daten für die Anzeige verwendet werden sollen
    let activeDataA = processedDataA;
    let activeDataB = processedDataB;
    let singleMode = false;

    if (!processedDataA && !processedDataB) {
        console.log("Keine Daten geladen.");
        // Optional: UI zurücksetzen (Slider deaktivieren etc.)
        timeSlider.disabled = true;
        return;
    }

    if (processedDataA || processedDataB) { // Nur wenn mindestens ein Datensatz da ist
        // ... (Existierender Code zum Zeichnen der Polylinien, Bounds, Marker) ...

        setupSlider();
        setupAltitudeChart(); // NEU: Höhendiagramm erstellen/aktualisieren
        // updateFromSlider(); 
        console.log("setupSlider, setupAltitudeChart und updateFromSlider aufgerufen.");
    } else {
        // UI zurücksetzen, wenn keine Daten da sind
        timeSlider.disabled = true;
        if (altitudeChartInstance) {
            altitudeChartInstance.destroy();
            altitudeChartInstance = null;
        }
        // Weitere UI-Resets hier...
    }

    if (processedDataA && !processedDataB) {
        console.log("Nur Track A geladen.");
        singleMode = true;
    } else if (!processedDataA && processedDataB) {
        console.log("Nur Track B geladen.");
        singleMode = true;
        // Für die Logik unten ist es einfacher, wenn immer activeDataA gefüllt ist, falls nur B da ist.
        // Dies ist ein kleiner Workaround, um nicht alle Funktionen umschreiben zu müssen.
        // Besser wäre es, die Funktionen flexibler zu machen.
        // Fürs Erste: Wenn nur B, behandle es intern wie A für die Anzeige, aber merke dir, dass es B ist.
        // Dieser Ansatz wird hier nicht weiterverfolgt, da er die Anzeige der Spalten verkompliziert.
        // Wir zeigen einfach nur die Daten für den geladenen Track an.
    } else if (processedDataA && processedDataB) {
        console.log("Beide Tracks geladen.");
    }

    if (!map && !initMap()) {
        console.error("Map konnte nicht initialisiert werden in checkAndProcessFiles. Abbruch.");
        return;
    }
    console.log("Map ist initialisiert oder war bereits vorhanden.");

    // Ähnlichkeitsprüfung nur, wenn beide da sind
    if (mode === 'compare' && activeDataA && activeDataB) {
        if (typeof activeDataA.totalDistance === 'number' && typeof activeDataB.totalDistance === 'number') {
            console.log("Rufe checkTrackSimilarity auf.");
            checkTrackSimilarity(activeDataA, activeDataB);
        } else {
            similarityWarning.textContent = "Warte auf Distanzdaten für Ähnlichkeitsprüfung...";
            console.warn("totalDistance ist für einen oder beide Tracks nicht definiert, Ähnlichkeitsprüfung übersprungen.");
        }
        console.log("Data A totalDistance:", activeDataA.totalDistance);
        console.log("Data B totalDistance:", activeDataB.totalDistance);
    } else {
        similarityWarning.textContent = ''; // Keine Ähnlichkeitsprüfung bei nur einem Track oder im Analysemodus
    }

    // Alte Polylinien und Marker entfernen
    if (polylineA && map.hasLayer(polylineA)) map.removeLayer(polylineA);
    if (polylineB && map.hasLayer(polylineB)) map.removeLayer(polylineB);
    if (markerA && map.hasLayer(markerA)) map.removeLayer(markerA);
    if (markerB && map.hasLayer(markerB)) map.removeLayer(markerB);
    polylineA = null; polylineB = null; // Zurücksetzen

    let bounds = null;

    if (activeDataA) {
        const latLngsA = (activeDataA.records || []).map(p => [p.lat, p.lon]);
        console.log("latLngsA length:", latLngsA.length, "First 3 A:", latLngsA.slice(0, 3));
        if (latLngsA.length > 0) {
            polylineA = L.polyline(latLngsA, { color: 'blue', weight: 3, opacity: 0.7 }).addTo(map);
            console.log("Polyline A zur Karte hinzugefügt.");
            bounds = L.latLngBounds(latLngsA);
        } else {
            console.warn("Keine Datenpunkte für Polyline A.");
        }
        markerA = L.circleMarker([0, 0], { radius: 8, color: 'white', fillColor: 'blue', fillOpacity: 1, weight: 2 });
    }

    if (activeDataB) {
        const latLngsB = (activeDataB.records || []).map(p => [p.lat, p.lon]);
        console.log("latLngsB length:", latLngsB.length, "First 3 B:", latLngsB.slice(0, 3));
        if (latLngsB.length > 0) {
            polylineB = L.polyline(latLngsB, { color: 'red', weight: 3, opacity: 0.7 }).addTo(map);
            console.log("Polyline B zur Karte hinzugefügt.");
            if (bounds) {
                bounds.extend(L.latLngBounds(latLngsB));
            } else {
                bounds = L.latLngBounds(latLngsB);
            }
        } else {
            console.warn("Keine Datenpunkte für Polyline B.");
        }
        markerB = L.circleMarker([0, 0], { radius: 8, color: 'white', fillColor: 'red', fillOpacity: 1, weight: 2 });
    }

    console.log("Calculated bounds object:", bounds);
    if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30] });
        map.invalidateSize();
        console.log("map.fitBounds mit validen Bounds aufgerufen und invalidateSize() ausgeführt:", bounds.toBBoxString());
    } else {
        console.warn("Keine gültigen Koordinaten zum Zoomen gefunden. Karte bleibt auf Standardansicht.");
    }

    console.log("Marker A und B Logik initialisiert (noch nicht zur Karte hinzugefügt).");

    setupSlider();
    updateFromSlider();
    console.log("setupSlider und updateFromSlider aufgerufen.");

    console.log("--- Exiting checkAndProcessFiles ---");
}


function checkTrackSimilarity(dataA, dataB) {
    similarityWarning.textContent = ''; // Zurücksetzen

    // Zusätzliche Sicherheitsüberprüfungen am Anfang
    if (!dataA || !dataB || dataA.records.length === 0 || dataB.records.length === 0) {
        console.warn("checkTrackSimilarity: Ungültige Eingabedaten.");
        similarityWarning.textContent = "Fehler: Ungültige Daten für Ähnlichkeitsprüfung.";
        return false;
    }
    if (typeof dataA.totalDistance !== 'number' || typeof dataB.totalDistance !== 'number') {
        console.warn("checkTrackSimilarity: totalDistance ist nicht numerisch.");
        similarityWarning.textContent = "Fehler: Distanzdaten unvollständig.";
        return false;
    }


    const startA = dataA.records[0];
    const startB = dataB.records[0];
    // Sicherstellen, dass startA und startB Koordinaten haben
    if (!startA || startA.lat === null || startA.lon === null || !startB || startB.lat === null || startB.lon === null) {
        console.warn("checkTrackSimilarity: Startpunkte haben keine gültigen Koordinaten.");
        similarityWarning.textContent = "Warnung: Startpunkt-Koordinaten unvollständig.";
        return false; // Kann Ähnlichkeit nicht prüfen
    }


    const startDistanceKm = haversineDistance(startA.lat, startA.lon, startB.lat, startB.lon);
    const distanceThresholdKm = 2.0;

    // dataA.totalDistance sollte jetzt sicher eine Zahl sein.
    const distanceRatio = dataA.totalDistance > 0 ? dataB.totalDistance / dataA.totalDistance : 0;
    const distanceRatioThresholdMin = 0.8;
    const distanceRatioThresholdMax = 1.25;

    if (startDistanceKm > distanceThresholdKm) {
        similarityWarning.textContent = `Warnung: Startpunkte ${startDistanceKm.toFixed(2)}km entfernt.`; // toFixed sollte hier sicher sein
        return false;
    }
    if (!(distanceRatio >= distanceRatioThresholdMin && distanceRatio <= distanceRatioThresholdMax)) {
        // toFixed sollte hier sicher sein, da wir oben geprüft haben, dass totalDistance Zahlen sind
        similarityWarning.textContent = `Warnung: Distanzen (${dataA.totalDistance.toFixed(1)}km vs ${dataB.totalDistance.toFixed(1)}km) unterschiedlich.`;
        return false;
    }
    similarityWarning.textContent = "Strecken ähnlich.";
    return true;
}

function formatTime(ms, showMillis = false) {
    if (ms === null || isNaN(ms)) return "N/A";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    let formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (showMillis) formatted += `.${String(ms % 1000).padStart(3, '0')}`;
    return formatted;
}

function formatTrackTime(totalSeconds) {
    if (totalSeconds === null || isNaN(totalSeconds) || totalSeconds < 0) return "N/A";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setupSlider() {
    let minTime, maxTime, durationMs;

    if (processedDataA && processedDataB) {
        // Der Slider geht von 0 bis zur Dauer der längsten Aktivität
        durationMs = Math.max(processedDataA.totalDurationMs, processedDataB.totalDurationMs);
    } else if (processedDataA) {
        durationMs = processedDataA.totalDurationMs;
    } else if (processedDataB) {
        durationMs = processedDataB.totalDurationMs;
    } else {
        timeSlider.disabled = true;
        sliderTimeMinElem.textContent = "00:00:00";
        sliderTimeMaxElem.textContent = "00:00:00";
        currentTimeDisplayElem.textContent = "--:--:--";
        return; // Nichts zu tun, wenn keine Daten da sind
    }

    console.log("Slider Setup: durationMs=", durationMs);
    if (processedDataA) console.log("Track A totalDurationMs:", processedDataA.totalDurationMs);
    if (processedDataB) console.log("Track B totalDurationMs:", processedDataB.totalDurationMs);

    timeSlider.min = 0;
    timeSlider.max = durationMs;
    timeSlider.value = 0;
    timeSlider.step = 1000;
    timeSlider.disabled = false;

    sliderTimeMinElem.textContent = formatTime(0, false);
    sliderTimeMaxElem.textContent = formatTime(durationMs, false);

    // Bereichsbalken initial setzen (nur sinnvoll im Einzelmodus)
    if (mode === 'single' && processedDataA) {
        updateRangeFill(processedDataA.totalDurationMs);
    } else {
        updateRangeFill(0);
    }


    // Nur im Einzelmodus sinnvoll
    if (mode === 'single' && rangeStartSlider && rangeEndSlider) {
        rangeStartSlider.min = 0;
        rangeStartSlider.max = durationMs;
        rangeStartSlider.value = 0;
        rangeStartSlider.step = 1000;
        rangeStartSlider.disabled = false;

        rangeEndSlider.min = 0;
        rangeEndSlider.max = durationMs;
        rangeEndSlider.value = durationMs;
        rangeEndSlider.step = 1000;
        rangeEndSlider.disabled = false;

        if (rangeStartLabel) rangeStartLabel.textContent = formatTime(0, false);
        if (rangeEndLabel) rangeEndLabel.textContent = formatTime(durationMs, false);

        // HIER:
        updateRangeFill(durationMs);
    } else if (rangeStartSlider && rangeEndSlider) {
        rangeStartSlider.disabled = true;
        rangeEndSlider.disabled = true;
        // Optional: auch Balken leeren
        updateRangeFill(0);
    }


}

function findRecordAtOrBeforeTime(records, targetTimestamp) {
    if (!records || records.length === 0) return null;
    let bestMatch = null;
    for (const record of records) { if (record.timestamp <= targetTimestamp) bestMatch = record; else break; }
    return bestMatch;
}

// Hilfsfunktion, um den passenden Record anhand der *relativen* Zeit zu finden
function findRecordAtOrBeforeRelativeTime(records, targetRelativeTimestamp) {
    if (!records || records.length === 0) return null;
    let bestMatch = null;
    for (const record of records) {
        if (record.relativeTimestamp <= targetRelativeTimestamp) {
            bestMatch = record;
        } else {
            break;
        }
    }
    return bestMatch;
}

function calculateAveragePower(records, currentTimestamp, isRelative = false) {
    if (typeof math === 'undefined') { /* ... */ return 0; }
    const relevantRecords = records.filter(r => {
        const timestampToCompare = isRelative ? r.relativeTimestamp : r.timestamp;
        return timestampToCompare <= currentTimestamp && typeof r.power === 'number' && r.power > 0;
    });
    if (relevantRecords.length === 0) return 0;
    const powers = relevantRecords.map(r => r.power);
    return math.mean(powers);
}

function computeMaxAvgPowerOverDurations(records, startMs, endMs) {
    const result = {
        '5': { value: null, startOffsetMs: null },
        '10': { value: null, startOffsetMs: null },
        '20': { value: null, startOffsetMs: null },
        '60': { value: null, startOffsetMs: null }
    };

    if (!records || records.length === 0) return result;

    // Bereich zuschneiden
    const inRange = records.filter(r =>
        r.relativeTimestamp >= startMs && r.relativeTimestamp <= endMs
    );
    if (inRange.length === 0) return result;

    const sectionDurationSec = (endMs - startMs) / 1000;

    const durations = [
        { key: '5', seconds: 5 * 60 },
        { key: '10', seconds: 10 * 60 },
        { key: '20', seconds: 20 * 60 },
        { key: '60', seconds: 60 * 60 }
    ];

    durations.forEach(d => {
        const T = d.seconds;

        // Bereich zu kurz → N/A
        if (sectionDurationSec < T) {
            result[d.key] = { value: null, startOffsetMs: null };
            return;
        }

        let maxAvg = null;
        let bestStartMs = null;
        let iStart = 0;

        for (let i = 0; i < inRange.length; i++) {
            const tEnd = inRange[i].relativeTimestamp;
            const tStart = tEnd - T * 1000;

            // Fenster muss komplett im Bereich liegen
            if (tStart < startMs) continue;

            while (iStart < inRange.length &&
                inRange[iStart].relativeTimestamp < tStart) {
                iStart++;
            }
            if (iStart > i) continue;

            const window = inRange.slice(iStart, i + 1)
                .map(r => r.power)
                .filter(v => typeof v === 'number');
            if (window.length === 0) continue;

            const avg = window.reduce((a, b) => a + b, 0) / window.length;
            if (maxAvg === null || avg > maxAvg) {
                maxAvg = avg;
                bestStartMs = tStart; // absoluter Timestamp relativ zum Track-Start
            }
        }

        result[d.key] = {
            value: maxAvg,
            startOffsetMs: bestStartMs !== null ? (bestStartMs - startMs) : null
        };
    });

    return result;
}

function computeCumulativeDescentUpTo(records, targetRelativeTimestamp) {
    if (!records || records.length === 0) return null;

    let descentSum = 0;
    let prevAlt = null;

    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.relativeTimestamp > targetRelativeTimestamp) break;

        const currAlt = typeof r.altitude === 'number' && !isNaN(r.altitude)
            ? r.altitude
            : null;

        if (prevAlt != null && currAlt != null) {
            const diff = currAlt - prevAlt;
            if (diff < 0) descentSum += Math.abs(diff);
        }
        prevAlt = currAlt;
    }

    return descentSum;
}



function updateRangeStats() {
    // 1. Grundchecks
    if (
        mode !== 'single' ||
        !processedDataA ||
        !processedDataA.records ||
        processedDataA.records.length === 0 ||
        !rangeStartSlider ||
        !rangeEndSlider
    ) {
        if (rangeHrAElem)       rangeHrAElem.textContent       = 'N/A';
        if (rangeDistanceAElem) rangeDistanceAElem.textContent = 'N/A';
        if (rangeSpeedAElem)    rangeSpeedAElem.textContent    = 'N/A';
        if (rangePowerAElem)    rangePowerAElem.textContent    = 'N/A';
        if (rangeAscentAElem)   rangeAscentAElem.textContent   = 'N/A';
        if (rangeDescentAElem)  rangeDescentAElem.textContent  = 'N/A';
        if (rangeMaxPowerDurationsAElem) rangeMaxPowerDurationsAElem.textContent = 'N/A';

        if (altitudeChartInstance) {
            const ds = altitudeChartInstance.data.datasets;
            ['Bereich Start','Bereich Ende','Max 5min','Max 10min','Max 20min','Max 60min']
                .forEach(label => {
                    const idx = ds.findIndex(d => d.label === label);
                    if (idx !== -1) ds[idx].data = [];
                });
            altitudeChartInstance.update('none');
        }
        return;
    }

    const startMs = parseInt(rangeStartSlider.value);
    const endMs   = parseInt(rangeEndSlider.value);

    // 2. Bereich ungültig
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
        if (rangeHrAElem)       rangeHrAElem.textContent       = 'N/A';
        if (rangeDistanceAElem) rangeDistanceAElem.textContent = 'N/A';
        if (rangeSpeedAElem)    rangeSpeedAElem.textContent    = 'N/A';
        if (rangePowerAElem)    rangePowerAElem.textContent    = 'N/A';
        if (rangeAscentAElem)   rangeAscentAElem.textContent   = 'N/A';
        if (rangeDescentAElem)  rangeDescentAElem.textContent  = 'N/A';
        if (rangeMaxPowerDurationsAElem) rangeMaxPowerDurationsAElem.textContent = 'N/A';

        if (altitudeChartInstance) {
            const ds = altitudeChartInstance.data.datasets;
            ['Bereich Start','Bereich Ende','Max 5min','Max 10min','Max 20min','Max 60min']
                .forEach(label => {
                    const idx = ds.findIndex(d => d.label === label);
                    if (idx !== -1) ds[idx].data = [];
                });
            altitudeChartInstance.update('none');
        }
        return;
    }

    const records = processedDataA.records;

    // 3. Records im Bereich
    const inRange = records.filter(r =>
        r.relativeTimestamp >= startMs && r.relativeTimestamp <= endMs
    );

    if (inRange.length === 0) {
        if (rangeHrAElem)       rangeHrAElem.textContent       = 'N/A';
        if (rangeDistanceAElem) rangeDistanceAElem.textContent = 'N/A';
        if (rangeSpeedAElem)    rangeSpeedAElem.textContent    = 'N/A';
        if (rangePowerAElem)    rangePowerAElem.textContent    = 'N/A';
        if (rangeAscentAElem)   rangeAscentAElem.textContent   = 'N/A';
        if (rangeDescentAElem)  rangeDescentAElem.textContent  = 'N/A';
        if (rangeMaxPowerDurationsAElem) rangeMaxPowerDurationsAElem.textContent = 'N/A';

        if (altitudeChartInstance) {
            const ds = altitudeChartInstance.data.datasets;
            ['Bereich Start','Bereich Ende','Max 5min','Max 10min','Max 20min','Max 60min']
                .forEach(label => {
                    const idx = ds.findIndex(d => d.label === label);
                    if (idx !== -1) ds[idx].data = [];
                });
            altitudeChartInstance.update('none');
        }
        return;
    }

    const first = inRange[0];
    const last  = inRange[inRange.length - 1];

    const rangeDurationMs = last.relativeTimestamp - first.relativeTimestamp;

    // HF
    const hrValues = inRange
        .map(r => r.heart_rate)
        .filter(v => typeof v === 'number');
    const avgHr = hrValues.length
        ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length
        : null;

    // Distanz
    const deltaDistance =
        typeof last.distance === 'number' && typeof first.distance === 'number'
            ? Math.max(0, last.distance - first.distance)
            : null;

    // Ø Geschwindigkeit (km/h)
    let avgSpeedRange = null;
    if (rangeDurationMs > 0 && deltaDistance != null) {
        const hours = rangeDurationMs / (1000 * 60 * 60);
        avgSpeedRange = hours > 0 ? deltaDistance / hours : null;
    }

    // Ø Power
    const pValues = inRange
        .map(r => r.power)
        .filter(v => typeof v === 'number');
    const avgPower = pValues.length
        ? pValues.reduce((a, b) => a + b, 0) / pValues.length
        : null;

    // Anstieg
    const deltaAscent =
        typeof last.accumulated_ascent === 'number' &&
        typeof first.accumulated_ascent === 'number'
            ? Math.max(0, last.accumulated_ascent - first.accumulated_ascent)
            : null;

    // Abstieg
    let deltaDescent = null;
    if (
        typeof last.accumulated_descent === 'number' &&
        typeof first.accumulated_descent === 'number'
    ) {
        deltaDescent = Math.max(0, last.accumulated_descent - first.accumulated_descent);
    } else {
        let descentSum = 0;
        for (let i = 1; i < inRange.length; i++) {
            const prevAlt = inRange[i - 1].altitude;
            const currAlt = inRange[i].altitude;
            if (
                typeof prevAlt === 'number' &&
                typeof currAlt === 'number' &&
                !isNaN(prevAlt) &&
                !isNaN(currAlt)
            ) {
                const diff = currAlt - prevAlt;
                if (diff < 0) descentSum += Math.abs(diff);
            }
        }
        deltaDescent = descentSum;
    }

    // Max. Ø Power 5/10/20/60
    const maxAvgP = computeMaxAvgPowerOverDurations(records, startMs, endMs);

    // 5. Textwerte
    if (rangeHrAElem) rangeHrAElem.textContent =
        avgHr != null ? avgHr.toFixed(0) : 'N/A';

    if (rangeDistanceAElem) rangeDistanceAElem.textContent =
        deltaDistance != null ? deltaDistance.toFixed(2) + ' km' : 'N/A';

    if (rangeSpeedAElem) rangeSpeedAElem.textContent =
        avgSpeedRange != null ? avgSpeedRange.toFixed(1) + ' km/h' : 'N/A';

    if (rangePowerAElem) rangePowerAElem.textContent =
        avgPower != null ? avgPower.toFixed(1) : 'N/A';

    if (rangeAscentAElem) rangeAscentAElem.textContent =
        deltaAscent != null ? deltaAscent.toFixed(0) + ' m' : 'N/A';

    if (rangeDescentAElem) rangeDescentAElem.textContent =
        deltaDescent != null ? deltaDescent.toFixed(0) + ' m' : 'N/A';

    if (rangeDurationAElem) {
        rangeDurationAElem.textContent =
            rangeDurationMs > 0 ? formatTime(rangeDurationMs, false) : 'N/A';
    }

    if (rangeMaxPowerDurationsAElem) {
        const parts = [];
        const addPart = (label, obj) => {
            if (obj && obj.value != null) {
                const absStart = startMs + (obj.startOffsetMs || 0);
                const timeStr  = formatTime(absStart, false);
                parts.push(`${label}: ${obj.value.toFixed(0)} W (ab ${timeStr})`);
            }
        };
        addPart("5'",  maxAvgP['5']);
        addPart("10'", maxAvgP['10']);
        addPart("20'", maxAvgP['20']);
        addPart("60'", maxAvgP['60']);
        rangeMaxPowerDurationsAElem.textContent =
            parts.length ? parts.join(', ') : 'N/A';
    }

    // 6. Bereich + Max-Intervalle im Höhenprofil
    if (altitudeChartInstance) {
        const xAxisType = altitudeChartInstance.options.scales.x.title.text.includes('km')
            ? 'distance'
            : 'relativeTime';

        const datasets        = altitudeChartInstance.data.datasets;
        const rangeStartIndex = datasets.findIndex(ds => ds.label === 'Bereich Start');
        const rangeEndIndex   = datasets.findIndex(ds => ds.label === 'Bereich Ende');
        const i5              = datasets.findIndex(ds => ds.label === 'Max 5min');
        const i10             = datasets.findIndex(ds => ds.label === 'Max 10min');
        const i20             = datasets.findIndex(ds => ds.label === 'Max 20min');
        const i60             = datasets.findIndex(ds => ds.label === 'Max 60min');

        const yMin = altitudeChartInstance.scales.y.min;
        const yMax = altitudeChartInstance.scales.y.max;

        let xStart, xEnd;
        if (xAxisType === 'distance') {
            xStart = first.distance;
            xEnd   = last.distance;
        } else {
            xStart = first.relativeTimestamp / 1000;
            xEnd   = last.relativeTimestamp / 1000;
        }

        if (rangeStartIndex !== -1) {
            datasets[rangeStartIndex].data = [
                { x: xStart, y: yMin },
                { x: xStart, y: yMax }
            ];
        }
        if (rangeEndIndex !== -1) {
            datasets[rangeEndIndex].data = [
                { x: xEnd, y: yMin },
                { x: xEnd, y: yMax }
            ];
        }

        const ySpan = yMax - yMin;
        const base  = yMin + ySpan * 0.15;

        function setIntervalDataset(idx, obj, durationSec, offsetFactor) {
            if (idx === -1) return;
            if (!obj || obj.value == null || obj.startOffsetMs == null) {
                datasets[idx].data = [];
                return;
            }

            const startAbsMs = startMs + obj.startOffsetMs;
            const endAbsMs   = startAbsMs + durationSec * 1000;

            let xIntStart, xIntEnd;
            if (xAxisType === 'distance') {
                const recStart = findRecordAtOrBeforeRelativeTime(processedDataA.records, startAbsMs);
                const recEnd   = findRecordAtOrBeforeRelativeTime(processedDataA.records, endAbsMs);
                if (!recStart || !recEnd) {
                    datasets[idx].data = [];
                    return;
                }
                xIntStart = recStart.distance;
                xIntEnd   = recEnd.distance;
            } else {
                xIntStart = startAbsMs / 1000;
                xIntEnd   = endAbsMs / 1000;
            }

            const yLevel = base + ySpan * offsetFactor;
            datasets[idx].data = [
                { x: xIntStart, y: yLevel },
                { x: xIntEnd,   y: yLevel }
            ];
        }

        setIntervalDataset(i5,  maxAvgP['5'],  5 * 60, 0.00);
        setIntervalDataset(i10, maxAvgP['10'], 10 * 60, 0.05);
        setIntervalDataset(i20, maxAvgP['20'], 20 * 60, 0.10);
        setIntervalDataset(i60, maxAvgP['60'], 60 * 60, 0.15);

        altitudeChartInstance.update('none');
    }
}




function updateFromSlider() {
    if (!map) return;

    const currentRelativeTime = parseInt(timeSlider.value) || 0;
    if (currentTimeDisplayElem) {
        currentTimeDisplayElem.textContent = formatTime(currentRelativeTime, false);
    }

    let recordA = null;
    let recordB = null;

    if (processedDataA) {
        recordA = findRecordAtOrBeforeRelativeTime(processedDataA.records, currentRelativeTime);
        updateDataDisplay('A', recordA, 0, currentRelativeTime);
        if (markerA) {
            if (recordA && recordA.lat !== null && recordA.lon !== null) {
                markerA.setLatLng([recordA.lat, recordA.lon]);
                if (!map.hasLayer(markerA)) markerA.addTo(map);
            } else if (map.hasLayer(markerA)) {
                map.removeLayer(markerA);
            }
        }
    } else {
        updateDataDisplay('A', null, 0, currentRelativeTime);
        if (markerA && map.hasLayer(markerA)) map.removeLayer(markerA);
    }

    if (processedDataB) {
        recordB = findRecordAtOrBeforeRelativeTime(processedDataB.records, currentRelativeTime);
        updateDataDisplay('B', recordB, 0, currentRelativeTime);
        if (markerB) {
            if (recordB && recordB.lat !== null && recordB.lon !== null) {
                markerB.setLatLng([recordB.lat, recordB.lon]);
                if (!map.hasLayer(markerB)) markerB.addTo(map);
            } else if (map.hasLayer(markerB)) {
                map.removeLayer(markerB);
            }
        }
    } else {
        updateDataDisplay('B', null, 0, currentRelativeTime);
        if (markerB && map.hasLayer(markerB)) map.removeLayer(markerB);
    }

    // Punkte im Höhenprofil aktualisieren
    if (altitudeChartInstance) {
        const xAxisType = altitudeChartInstance.options.scales.x.title.text.includes('km')
            ? 'distance'
            : 'relativeTime';

        const posAIndex      = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Position A');
        const hairlineAIndex = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Haarlinie A');
        const posBIndex      = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Position B');
        const hairlineBIndex = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Haarlinie B');

        let pointDataA = [], hairlineDataA = [], pointDataB = [], hairlineDataB = [];

        if (recordA && posAIndex !== -1 && hairlineAIndex !== -1) {
            const xVal = xAxisType === 'distance' ? recordA.distance : recordA.relativeTimestamp / 1000;
            const yVal = recordA.altitude;
            if (xVal !== undefined && yVal !== null) {
                pointDataA = [{ x: xVal, y: yVal }];
                hairlineDataA = [
                    { x: xVal, y: altitudeChartInstance.scales.y.min },
                    { x: xVal, y: yVal }
                ];
            }
        }

        if (recordB && posBIndex !== -1 && hairlineBIndex !== -1) {
            const xVal = xAxisType === 'distance' ? recordB.distance : recordB.relativeTimestamp / 1000;
            const yVal = recordB.altitude;
            if (xVal !== undefined && yVal !== null) {
                pointDataB = [{ x: xVal, y: yVal }];
                hairlineDataB = [
                    { x: xVal, y: altitudeChartInstance.scales.y.min },
                    { x: xVal, y: yVal }
                ];
            }
        }

        if (posAIndex      !== -1) altitudeChartInstance.data.datasets[posAIndex].data      = pointDataA;
        if (hairlineAIndex !== -1) altitudeChartInstance.data.datasets[hairlineAIndex].data = hairlineDataA;
        if (posBIndex      !== -1) altitudeChartInstance.data.datasets[posBIndex].data      = pointDataB;
        if (hairlineBIndex !== -1) altitudeChartInstance.data.datasets[hairlineBIndex].data = hairlineDataB;

        altitudeChartInstance.update('none');
    }

    if (mode === 'single' && processedDataA) {
        updateRangeStats();
    }
}



function updateRangeFill(durationMs) {
    if (!rangeBarFill || !rangeStartSlider || !rangeEndSlider || !durationMs || durationMs <= 0) {
        if (rangeBarFill) {
            rangeBarFill.style.left = '5%';
            rangeBarFill.style.width = '0%';
        }
        return;
    }

    const start = parseInt(rangeStartSlider.value);
    const end = parseInt(rangeEndSlider.value);

    if (isNaN(start) || isNaN(end) || end <= start) {
        rangeBarFill.style.left = '5%';
        rangeBarFill.style.width = '0%';
        return;
    }

    const leftPercent = 5 + (start / durationMs) * 90;  // 5–95 %
    const rightPercent = 5 + (end / durationMs) * 90;

    rangeBarFill.style.left = `${leftPercent}%`;
    rangeBarFill.style.width = `${rightPercent - leftPercent}%`;
}




// updateDataDisplay, parseFitFile, checkTrackSimilarity, formatTime, formatTrackTime, 
// findRecordAtOrBeforeRelativeTime, calculateAveragePower, assignDOMElements, 
// initializeAppLogic und DOMContentLoaded bleiben im Kern gleich wie in deiner funktionierenden Version,
// mit den Anpassungen für die Distanzanzeige und die Endzustände in updateDataDisplay.

// WICHTIG: Die parseFitFile muss die `totalDurationMs` korrekt zurückgeben.
// WICHTIG: Die updateDataDisplay Funktion muss so angepasst sein, dass sie "N/A" anzeigt,
//          wenn der jeweilige Track (A oder B) keine Daten hat.
//          Deine bestehende `updateDataDisplay` sollte das mit der `if (!fullData || ...)` Prüfung schon gut machen.

function updateDataDisplay(trackId, record, trackStartTime_relative, currentRelativeTimeOnSlider) {
    const dataElems = {
        time: trackId === 'A' ? timeAElem : timeBElem,
        distance: trackId === 'A' ? document.getElementById('distanceA') : document.getElementById('distanceB'),
        altitude: trackId === 'A' ? altitudeAElem : altitudeBElem,
        ascent: trackId === 'A' ? ascentAElem : ascentBElem,
        descent: trackId === 'A' ? descentAElem : descentBElem,
        hr: trackId === 'A' ? hrAElem : hrBElem,
        speed: trackId === 'A' ? speedAElem : speedBElem,
        power: trackId === 'A' ? powerAElem : powerBElem,
        avgPower: trackId === 'A' ? avgPowerAElem : avgPowerBElem
    };


    const fullData = trackId === 'A' ? processedDataA : processedDataB;

    if (!fullData || fullData.records.length === 0) {
        Object.values(dataElems).forEach(el => { if (el) el.textContent = "N/A"; });
        return;
    }

    let displayRecord = record;
    let isTrackFinished = currentRelativeTimeOnSlider > fullData.totalDurationMs;

    if (isTrackFinished) {
        displayRecord = fullData.records[fullData.records.length - 1];
        if (dataElems.time) dataElems.time.textContent = formatTrackTime(fullData.totalDurationMs / 1000);
    } else if (record) {
        if (dataElems.time) dataElems.time.textContent = formatTrackTime(record.relativeTimestamp / 1000);
    } else {
        Object.values(dataElems).forEach(el => { if (el) el.textContent = "N/A"; });
        return;
    }

    if (displayRecord) {
        if (dataElems.distance) dataElems.distance.textContent = displayRecord.distance !== undefined ? displayRecord.distance.toFixed(2) + " km" : "N/A";
        if (dataElems.altitude) dataElems.altitude.textContent = displayRecord.altitude !== undefined && displayRecord.altitude !== null ? Math.round(displayRecord.altitude) + " m" : "N/A"; // Aktuelle Höhe
        if (dataElems.ascent) dataElems.ascent.textContent = displayRecord.accumulated_ascent !== undefined ? Math.round(displayRecord.accumulated_ascent) + " m" : "N/A"; // Kumulierte Höhe
        if (dataElems.descent) {
            const targetTs = isTrackFinished
                ? fullData.totalDurationMs
                : displayRecord.relativeTimestamp;

            const cumDescent = computeCumulativeDescentUpTo(fullData.records, targetTs);
            dataElems.descent.textContent =
                cumDescent != null ? Math.round(cumDescent) + ' m' : 'N/A';
        }

        if (dataElems.hr) dataElems.hr.textContent = displayRecord.heart_rate !== undefined ? displayRecord.heart_rate : "N/A";
        if (dataElems.speed) dataElems.speed.textContent = displayRecord.speed !== undefined ? parseFloat(displayRecord.speed).toFixed(1) : "N/A";
        if (dataElems.power) dataElems.power.textContent = displayRecord.power !== undefined ? displayRecord.power : "N/A";

        const avgPowerTimestamp = isTrackFinished ? fullData.totalDurationMs : displayRecord.relativeTimestamp;
        const avgPower = calculateAveragePower(fullData.records, avgPowerTimestamp, true);
        if (dataElems.avgPower) dataElems.avgPower.textContent = avgPower > 0 ? avgPower.toFixed(1) : "N/A";
    } else {
        Object.values(dataElems).forEach(el => { if (el) el.textContent = "N/A"; });
    }
}

function assignDOMElements() {
    fitFileAInput = document.getElementById('fitFileA');
    fitFileBInput = document.getElementById('fitFileB');
    timeSlider = document.getElementById('timeSlider');
    loader = document.getElementById('loader');
    similarityWarning = document.getElementById('similarityWarning');

    sliderTimeMinElem = document.getElementById('sliderTimeMin');
    sliderTimeMaxElem = document.getElementById('sliderTimeMax');
    currentTimeDisplayElem = document.getElementById('currentTimeDisplay');

    timeAElem = document.getElementById('timeA');
    timeBElem = document.getElementById('timeB');
    hrAElem = document.getElementById('hrA');
    hrBElem = document.getElementById('hrB');
    speedAElem = document.getElementById('speedA');
    speedBElem = document.getElementById('speedB');
    powerAElem = document.getElementById('powerA');
    powerBElem = document.getElementById('powerB');
    avgPowerAElem = document.getElementById('avgPowerA');
    avgPowerBElem = document.getElementById('avgPowerB');
    altitudeAElem = document.getElementById('altitudeA');
    altitudeBElem = document.getElementById('altitudeB');
    ascentAElem = document.getElementById('ascentA');
    ascentBElem = document.getElementById('ascentB');
    descentAElem = document.getElementById('descentA');
    descentBElem = document.getElementById('descentB');


    modeRadios = document.querySelectorAll('input[name="mode"]');

    rangeStartSlider = document.getElementById('rangeStart');
    rangeEndSlider = document.getElementById('rangeEnd');
    rangeStartLabel = document.getElementById('rangeStartLabel');
    rangeEndLabel = document.getElementById('rangeEndLabel');

    rangeDurationAElem = document.getElementById('rangeDurationA');
    rangeHrAElem = document.getElementById('rangeHrA');
    rangeDistanceAElem = document.getElementById('rangeDistanceA');
    rangePowerAElem = document.getElementById('rangePowerA');
    rangeAscentAElem = document.getElementById('rangeAscentA');
    rangeDescentAElem = document.getElementById('rangeDescentA');
    rangeMaxPowerDurationsAElem = document.getElementById('rangeMaxPowerDurationsA');
    rangeSpeedAElem    = document.getElementById('rangeSpeedA');

    rangePanelElem = document.getElementById('rangePanel');

    rangeBarFill = document.getElementById('rangeBarFill');

    const distanceAElem = document.getElementById('distanceA');
    const distanceBElem = document.getElementById('distanceB');
    const mapDomElem = document.getElementById('map');

    const essentialDisplayElements = [
        timeAElem, timeBElem,
        hrAElem, hrBElem,
        speedAElem, speedBElem,
        powerAElem, powerBElem,
        avgPowerAElem, avgPowerBElem,
        distanceAElem, distanceBElem,
        altitudeAElem, altitudeBElem,
        ascentAElem, ascentBElem,
        descentAElem, descentBElem,
        rangeDurationAElem,
        rangeHrAElem,
        rangeDistanceAElem,
        rangePowerAElem,
        rangeAscentAElem,
        rangeDescentAElem,
        rangeMaxPowerDurationsAElem
    ];

    const allElements = [
        fitFileAInput,
        fitFileBInput,
        timeSlider,
        loader,
        similarityWarning,
        sliderTimeMinElem,
        sliderTimeMaxElem,
        currentTimeDisplayElem,
        mapDomElem,
        ...essentialDisplayElements
    ];

    for (const el of allElements) {
        if (!el) {
            console.error('Kritisches DOM-Element nicht gefunden bei Zuweisung:', el);
            const ids = [
                'fitFileA', 'fitFileB', 'timeSlider', 'loader', 'similarityWarning',
                'sliderTimeMin', 'sliderTimeMax', 'currentTimeDisplay', 'map',
                'timeA', 'timeB', 'hrA', 'hrB', 'speedA', 'speedB',
                'powerA', 'powerB', 'avgPowerA', 'avgPowerB',
                'distanceA', 'distanceB',
                'altitudeA', 'altitudeB', 'ascentA', 'ascentB',
                'rangeDurationA', 'rangeHrA', 'rangeDistanceA', 'rangePowerA',
                'rangeAscentA', 'rangeDescentA', 'rangeMaxPowerDurationsA'
            ];
            for (const id of ids) {
                if (!document.getElementById(id)) {
                    console.error(` Fehlendes Element hat möglicherweise die ID: ${id}`);
                    break;
                }
            }
            alert('Einige UI-Elemente konnten nicht geladen werden. Bitte die HTML-Struktur und IDs prüfen.');
            return false;
        }
    }

    modeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            mode = radio.value; // 'single' oder 'compare'
            applyModeToUI();
            checkAndProcessFiles();
        });
    });

    return true;
}


function initializeAppLogic() {
    if (!assignDOMElements()) {
        console.error("Zuweisung der DOM-Elemente fehlgeschlagen. App kann nicht initialisiert werden.");
        return;
    }
    if (!initMap()) {
        console.error("Initialisierung der Karte fehlgeschlagen. App kann nicht initialisiert werden.");
        return;
    }
    // Modus initial anwenden
    applyModeToUI();

    fitFileAInput.addEventListener('change', async (event) => {
        const file = event.target.files[0]; if (file) {
            loader.style.display = 'block'; similarityWarning.textContent = '';
            try { processedDataA = await parseFitFile(file, 'A'); console.log("Fit A Parsed:", processedDataA); checkAndProcessFiles(); }
            catch (error) { alert("Fehler Datei A: " + error); processedDataA = null; }
            loader.style.display = 'none';
        }
    });
    fitFileBInput.addEventListener('change', async (event) => {
        const file = event.target.files[0]; if (file) {
            loader.style.display = 'block'; similarityWarning.textContent = '';
            try { processedDataB = await parseFitFile(file, 'B'); console.log("Fit B Parsed:", processedDataB); checkAndProcessFiles(); }
            catch (error) { alert("Fehler Datei B: " + error); processedDataB = null; }
            loader.style.display = 'none';
        }
    });
    timeSlider.addEventListener('input', () => {
        if (!throttleTimeout) {
            throttleTimeout = setTimeout(() => {
                updateFromSlider();
                throttleTimeout = null;
            }, THROTTLE_DELAY);
        }
    });
    if (rangeStartSlider && rangeEndSlider) {
        rangeStartSlider.addEventListener('input', () => {
            const startVal = parseInt(rangeStartSlider.value);
            let endVal = parseInt(rangeEndSlider.value);

            if (startVal > endVal) {
                endVal = startVal;
                rangeEndSlider.value = String(endVal);
            }

            if (rangeStartLabel) rangeStartLabel.textContent = formatTime(startVal, false);
            if (rangeEndLabel) rangeEndLabel.textContent = formatTime(endVal, false);

            const durationMs =
                processedDataA && typeof processedDataA.totalDurationMs === 'number'
                    ? processedDataA.totalDurationMs
                    : parseInt(timeSlider.max) || 0;

            updateRangeStats();
            updateRangeFill(durationMs);

        });


        rangeEndSlider.addEventListener('input', () => {
            let startVal = parseInt(rangeStartSlider.value);
            const endVal = parseInt(rangeEndSlider.value);

            if (endVal < startVal) {
                startVal = endVal;
                rangeStartSlider.value = String(startVal);
            }

            if (rangeStartLabel) rangeStartLabel.textContent = formatTime(startVal, false);
            if (rangeEndLabel) rangeEndLabel.textContent = formatTime(endVal, false);

            const durationMs =
                processedDataA && typeof processedDataA.totalDurationMs === 'number'
                    ? processedDataA.totalDurationMs
                    : parseInt(timeSlider.max) || 0;

            updateRangeStats();
            updateRangeFill(durationMs);
        });
    }

    console.log("App-Logik erfolgreich initialisiert.");
}


// Startpunkt: Warten auf DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event.");
    // Der Bibliothekscheck entfällt, da Parcel das übernimmt.
    initializeAppLogic();
});