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


// DOM Elemente (werden im DOMContentLoaded zugewiesen)
let fitFileAInput, fitFileBInput, timeSlider, loader, similarityWarning, mapElement;
let sliderTimeMinElem, sliderTimeMaxElem, currentTimeDisplayElem;
let timeAElem, timeBElem, hrAElem, hrBElem, speedAElem, speedBElem;
let powerAElem, powerBElem, avgPowerAElem, avgPowerBElem;
let altitudeAElem, altitudeBElem, ascentAElem, ascentBElem; 

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
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
            try {
                const fitParser = new FitFileParser({
                    force: true,
                    speedUnit: 'km/h',    // Sollte r.speed in km/h liefern
                    lengthUnit: 'km',     // Sollte Längen/Höhen in km liefern (z.B. enhanced_altitude)
                    temperatureUnit: 'celsius',
                    elapsedRecordField: true,
                    mode: 'list',
                });
                const arrayBuffer = event.target.result;
                fitParser.parse(arrayBuffer, (error, data) => {
                    if (error) { /* ... Fehlerbehandlung ... */ reject(error); return; }
                    const records = data.records || [];
                    if (records.length === 0) { /* ... Fehlerbehandlung ... */ reject("No records"); return; }

                    const activityStartTime = records[0].timestamp.getTime();
                    
                    // Diese Variablen MÜSSEN außerhalb des .map() Callbacks deklariert werden,
                    // damit sie über alle Records hinweg akkumulieren können.
                    let accumulatedTotalDistance = 0;
                    let accumulatedAscent = 0; 
                    let lastPoint = null;
                    let lastAltitudeForAscentCalculation = null; // Umbenannt für Klarheit

                    const processedRecords = records
                        .filter(r => r.timestamp && r.position_lat !== undefined && r.position_long !== undefined)
                        .map((r, index) => {
                            const lat = r.position_lat;
                            const lon = r.position_long;
                            const absoluteTimestamp = r.timestamp.getTime();
                            const relativeTimestamp = absoluteTimestamp - activityStartTime;
                            
                            // --- Höhe verarbeiten ---
                            let rawAltitudeFromParser = r.enhanced_altitude; 
                            if (rawAltitudeFromParser === undefined) { 
                                rawAltitudeFromParser = r.altitude;
                            }
                            let currentAltitudeInMeters = null; 
                            if (rawAltitudeFromParser !== undefined && rawAltitudeFromParser !== null && typeof rawAltitudeFromParser === 'number' && !isNaN(rawAltitudeFromParser)) {
                                // ANNAHME: Da lengthUnit='km' ist, liefert der Parser enhanced_altitude in km.
                                currentAltitudeInMeters = rawAltitudeFromParser * 1000; 
                            }
                        
							// --- Geschwindigkeit verarbeiten ---
                            let currentSpeedKmh = 0; 
                            
                            // NEUE ANNAHME: Die Parser-Option speedUnit: 'km/h' wirkt auf ALLE Geschwindigkeitsfelder.
                            if (r.enhanced_speed !== undefined && r.enhanced_speed !== null) {
                                currentSpeedKmh = r.enhanced_speed; // Direkt verwenden, da als km/h angenommen
                                if (index % 500 === 0) { 
                                    console.log(`  Speed: Using enhanced_speed ${r.enhanced_speed} (now assumed km/h directly from parser)`);
                                }
                            } else if (r.speed !== undefined && r.speed !== null) {
                                currentSpeedKmh = r.speed; // Direkt verwenden, da als km/h angenommen
                                if (index % 500 === 0) { 
                                    console.log(`  Speed: Using speed ${r.speed} (assumed km/h from parser option)`);
                                }
                            } else {
                                if (index % 500 === 0) { 
                                    console.log(`  Speed: No speed or enhanced_speed field found.`);
                            	}
                            }	
                            
							
                            // Distanzberechnung
                            let segmentDistance = 0; // Diese Variable ist lokal für jeden map-Durchlauf, das ist ok.
                            if (lastPoint && lat !== null && lon !== null) {
                                segmentDistance = haversineDistance(lastPoint.lat, lastPoint.lon, lat, lon);
                                accumulatedTotalDistance += segmentDistance; // Greift auf die äußere Variable zu
                            }
                            if (lat !== null && lon !== null) {
                                lastPoint = { lat, lon }; // Aktualisiert die äußere Variable
                            }
                            
                            // Kumulierte Höhenmeter berechnen
                            if (lastAltitudeForAscentCalculation !== null && currentAltitudeInMeters !== undefined && currentAltitudeInMeters !== null && !isNaN(currentAltitudeInMeters)) {
                                const altitudeChange = currentAltitudeInMeters - lastAltitudeForAscentCalculation;
                                if (altitudeChange > 0) {
                                    accumulatedAscent += altitudeChange; // Greift auf die äußere Variable zu
                                }
                            }
                            if (currentAltitudeInMeters !== undefined && currentAltitudeInMeters !== null && !isNaN(currentAltitudeInMeters)) {
                                lastAltitudeForAscentCalculation = currentAltitudeInMeters; // Aktualisiert die äußere Variable
                            }
                        
                            return {
                                timestamp: absoluteTimestamp,
                                relativeTimestamp: relativeTimestamp,
                                originalTimestamp: r.timestamp,
                                lat: lat, 
                                lon: lon,
                                heart_rate: r.heart_rate, 
                                speed: currentSpeedKmh,
                                power: r.power,
                                altitude: currentAltitudeInMeters,      
                                distance: accumulatedTotalDistance, 
                                accumulated_ascent: accumulatedAscent
                            };
                        }).filter(r => r.lat !== null && r.lon !== null && (r.lat !== 0 || r.lon !== 0));

                    if (processedRecords.length === 0) { /* ... */ reject("No valid GPS data"); return; }
                    
                    const activityEndTime = processedRecords.length > 0 ? processedRecords[processedRecords.length - 1].timestamp : activityStartTime;
                    const activityTotalDurationMs = activityEndTime - activityStartTime;

                    resolve({
                        records: processedRecords,
                        startTime: activityStartTime,
                        endTime: activityEndTime,    
                        totalDuration: activityTotalDurationMs / 1000,
                        totalDurationMs: activityTotalDurationMs,
                        totalDistance: accumulatedTotalDistance,
                        totalAscent: accumulatedAscent 
                    });
                });
            } catch (e) { /* ... */ reject(e); }
        };
        reader.onerror = () => { /* ... */ reject("Fehler beim Lesen der Datei."); };
        reader.readAsArrayBuffer(file);
    });
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
                        filter: function(legendItem, chartData) {
                            return legendItem.datasetIndex < 2 && (legendItem.text && legendItem.text.startsWith('Höhe'));
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if(label.startsWith('Position') || label.startsWith('Haarlinie')) return null; // Verstecke Tooltips für Punkte/Linien
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
    if (activeDataA && activeDataB) {
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
        similarityWarning.textContent = ''; // Keine Ähnlichkeitsprüfung bei nur einem Track
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
        console.log("latLngsA length:", latLngsA.length, "First 3 A:", latLngsA.slice(0,3));
        if (latLngsA.length > 0) {
            polylineA = L.polyline(latLngsA, { color: 'blue', weight: 3, opacity: 0.7 }).addTo(map);
            console.log("Polyline A zur Karte hinzugefügt.");
            bounds = L.latLngBounds(latLngsA);
        } else {
            console.warn("Keine Datenpunkte für Polyline A.");
        }
        markerA = L.circleMarker([0,0], { radius: 8, color: 'white', fillColor: 'blue', fillOpacity: 1, weight:2 });
    }

    if (activeDataB) {
        const latLngsB = (activeDataB.records || []).map(p => [p.lat, p.lon]);
        console.log("latLngsB length:", latLngsB.length, "First 3 B:", latLngsB.slice(0,3));
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
        markerB = L.circleMarker([0,0], { radius: 8, color: 'white', fillColor: 'red', fillOpacity: 1, weight:2 });
    }
    
    console.log("Calculated bounds object:", bounds);
    if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, {padding: [30,30]});
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
    if(processedDataA) console.log("Track A totalDurationMs:", processedDataA.totalDurationMs);
    if(processedDataB) console.log("Track B totalDurationMs:", processedDataB.totalDurationMs);

    timeSlider.min = 0; 
    timeSlider.max = durationMs; 
    timeSlider.value = 0;
    timeSlider.step = 1000; 
    timeSlider.disabled = false;
    
    sliderTimeMinElem.textContent = formatTime(0, false); 
    sliderTimeMaxElem.textContent = formatTime(durationMs, false);
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

function updateFromSlider() {
    if (!map) return; // Wenn Karte nicht da ist, nichts tun

    const currentRelativeTime = parseInt(timeSlider.value) || 0;
    if (currentTimeDisplayElem) currentTimeDisplayElem.textContent = formatTime(currentRelativeTime, false);

    let recordA = null;
    let recordB = null;

    if (processedDataA) {
        recordA = findRecordAtOrBeforeRelativeTime(processedDataA.records, currentRelativeTime);
        updateDataDisplay('A', recordA, 0, currentRelativeTime);
        if (markerA) {
            if (recordA && recordA.lat !== null && recordA.lon !== null) {
                markerA.setLatLng([recordA.lat, recordA.lon]); 
                if (!map.hasLayer(markerA)) markerA.addTo(map);
            } else { 
                if (map.hasLayer(markerA)) map.removeLayer(markerA); 
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
            } else { 
                if (map.hasLayer(markerB)) map.removeLayer(markerB); 
            }
        }
    } else {
        updateDataDisplay('B', null, 0, currentRelativeTime);
        if (markerB && map.hasLayer(markerB)) map.removeLayer(markerB);
    }

    // Update der Punkte im Höhendiagramm
    if (altitudeChartInstance) {
        const xAxisType = altitudeChartInstance.options.scales.x.title.text.includes('km') ? 'distance' : 'relativeTime';

        const posAIndex = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Position A');
        const hairlineAIndex = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Haarlinie A');
        const posBIndex = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Position B');
        const hairlineBIndex = altitudeChartInstance.data.datasets.findIndex(ds => ds.label === 'Haarlinie B');
        
        let pointDataA = [], hairlineDataA = [], pointDataB = [], hairlineDataB = [];

        if (recordA && posAIndex !== -1 && hairlineAIndex !== -1) {
            const xVal = xAxisType === 'distance' ? recordA.distance : recordA.relativeTimestamp / 1000;
            const yVal = recordA.altitude;
            if (xVal !== undefined && yVal !== null) {
                pointDataA = [{ x: xVal, y: yVal }];
                hairlineDataA = [{ x: xVal, y: altitudeChartInstance.scales.y.min }, { x: xVal, y: yVal }];
            }
        }
        
        if (recordB && posBIndex !== -1 && hairlineBIndex !== -1) {
            const xVal = xAxisType === 'distance' ? recordB.distance : recordB.relativeTimestamp / 1000;
            const yVal = recordB.altitude;
            if (xVal !== undefined && yVal !== null) {
                pointDataB = [{ x: xVal, y: yVal }];
                hairlineDataB = [{ x: xVal, y: altitudeChartInstance.scales.y.min }, { x: xVal, y: yVal }];
            }
        }
        
        if (posAIndex !== -1) altitudeChartInstance.data.datasets[posAIndex].data = pointDataA;
        if (hairlineAIndex !== -1) altitudeChartInstance.data.datasets[hairlineAIndex].data = hairlineDataA;
        if (posBIndex !== -1) altitudeChartInstance.data.datasets[posBIndex].data = pointDataB;
        if (hairlineBIndex !== -1) altitudeChartInstance.data.datasets[hairlineBIndex].data = hairlineDataB;

        altitudeChartInstance.update('none'); 
    }
    
    // DEBUGGING
    // console.log(`Slider RelTime: ${currentRelativeTime/1000}s, Record A valid: ${!!recordA}, Record B valid: ${!!recordB}`);
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
        distance: trackId === 'A' ? document.getElementById(`distanceA`) : document.getElementById(`distanceB`),
        altitude: trackId === 'A' ? document.getElementById(`altitudeA`) : document.getElementById(`altitudeB`), // NEU
        ascent: trackId === 'A' ? document.getElementById(`ascentA`) : document.getElementById(`ascentB`),       // NEU
        hr: trackId === 'A' ? hrAElem : hrBElem,
        speed: trackId === 'A' ? speedAElem : speedBElem,
        power: trackId === 'A' ? powerAElem : powerBElem,
        avgPower: trackId === 'A' ? avgPowerAElem : avgPowerBElem,
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
    // ... (existierende Zuweisungen) ...
    // timeAElem, hrAElem etc. sind schon da.
    // Wir brauchen jetzt noch distanceA und distanceB (werden im HTML hinzugefügt)
    
    // Stelle sicher, dass die Funktion true zurückgibt, wenn alle Elemente gefunden wurden
    // (Der bestehende Code für die Elementprüfung bleibt gleich)
    fitFileAInput = document.getElementById('fitFileA'); fitFileBInput = document.getElementById('fitFileB');
    timeSlider = document.getElementById('timeSlider'); loader = document.getElementById('loader');
    similarityWarning = document.getElementById('similarityWarning');
    sliderTimeMinElem = document.getElementById('sliderTimeMin'); sliderTimeMaxElem = document.getElementById('sliderTimeMax');
    currentTimeDisplayElem = document.getElementById('currentTimeDisplay');
    timeAElem = document.getElementById('timeA'); timeBElem = document.getElementById('timeB');
    hrAElem = document.getElementById('hrA'); hrBElem = document.getElementById('hrB');
    speedAElem = document.getElementById('speedA'); speedBElem = document.getElementById('speedB');
    powerAElem = document.getElementById('powerA'); powerBElem = document.getElementById('powerB');
    avgPowerAElem = document.getElementById('avgPowerA'); avgPowerBElem = document.getElementById('avgPowerB');
    timeAElem = document.getElementById('timeA'); timeBElem = document.getElementById('timeB');
    altitudeAElem = document.getElementById('altitudeA'); altitudeBElem = document.getElementById('altitudeB');
    ascentAElem = document.getElementById('ascentA'); ascentBElem = document.getElementById('ascentB');
    // mapElement wird in initMap geholt.

    // Wichtig: HTML muss um Distanz-Zellen erweitert werden!
    // document.getElementById('distanceA'), document.getElementById('distanceB')
    // werden in updateDataDisplay direkt geholt, da sie neu sind.
    // Besser wäre es, sie hier auch zu initialisieren, nachdem das HTML angepasst wurde.

    const essentialDisplayElements = [
        timeAElem, timeBElem, hrAElem, hrBElem, speedAElem, speedBElem,
        powerAElem, powerBElem, avgPowerAElem, avgPowerBElem,
        document.getElementById('distanceA'), document.getElementById('distanceB'), // Für die Prüfung
        altitudeAElem, altitudeBElem, ascentAElem, ascentBElem // Für die Prüfung
    ];
    
    const allElements = [
        fitFileAInput, fitFileBInput, timeSlider, loader, similarityWarning, sliderTimeMinElem, sliderTimeMaxElem,
        currentTimeDisplayElem, document.getElementById('map'), ...essentialDisplayElements
    ];

    for (const el of allElements) { 
        if (!el) { 
            console.error("Kritisches DOM-Element nicht gefunden bei Zuweisung:", el === mapElement ? "map" : el); 
            // Versuche, die ID zu finden, die fehlt
            const ids = ["fitFileA", "fitFileB", "timeSlider", "loader", "similarityWarning", 
                         "sliderTimeMin", "sliderTimeMax", "currentTimeDisplay", "map",
                         "timeA", "timeB", "hrA", "hrB", "speedA", "speedB", 
                         "powerA", "powerB", "avgPowerA", "avgPowerB"];
            for (const id of ids) {
                if (!document.getElementById(id)) {
                    console.error(` Fehlendes Element hat möglicherweise die ID: ${id}`);
                    break;
                }
            }
            alert("Einige UI-Elemente konnten nicht geladen werden. Bitte die HTML-Struktur und IDs prüfen."); 
            return false; 
        } 
    }
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
    console.log("App-Logik erfolgreich initialisiert und Event-Listener angehängt.");
}

// Startpunkt: Warten auf DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event.");
    // Der Bibliothekscheck entfällt, da Parcel das übernimmt.
    initializeAppLogic();
});