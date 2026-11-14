import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
    import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
    import { getDatabase, ref, onValue, set, query, orderByKey, limitToLast } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

    // Firebase web configuration for the existing Smart Mining Helmet project.
    // The API key identifies the Firebase project; Firebase Authentication and RTDB rules protect data.
    const firebaseConfig = {
      apiKey: 'api_key',
      authDomain: 'mining-helmet-13d03.firebaseapp.com',
      databaseURL: 'https://mining-helmet-13d03-default-rtdb.asia-southeast1.firebasedatabase.app',
      projectId: 'mining-helmet-13d03'
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getDatabase(app);

    const $ = (id) => document.getElementById(id);
    const loginLayer = $('loginLayer');
    const loginForm = $('loginForm');
    const loginButton = $('loginButton');
    const loginError = $('loginError');
    let liveUnsub = null, historyUnsub = null, commandUnsub = null;
    let latestLive = null;
    let historyRecords = [];
    let map, marker, accuracyCircle;
    let gasChart, tempChart, humidityChart;
    let toastTimer;

    function toast(message) {
      const el = $('toast');
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
    }

    function friendlyError(error) {
      const code = error?.code || '';
      const messages = {
        'auth/invalid-credential': 'Email or password is incorrect. Check the Firebase Authentication user.',
        'auth/user-not-found': 'No Firebase Authentication user exists with this email.',
        'auth/wrong-password': 'The Firebase account password is incorrect.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/too-many-requests': 'Too many login attempts. Wait and try again.',
        'auth/unauthorized-domain': 'Add localhost to Firebase Authentication → Settings → Authorized domains.',
        'auth/network-request-failed': 'Network request failed. Check your internet connection.',
        'PERMISSION_DENIED': 'Firebase denied database access. Check Realtime Database rules and signed-in user.'
      };
      return messages[code] || error?.message || 'An unexpected Firebase error occurred.';
    }

    function setConnection(kind, text) {
      $('firebaseStatus').textContent = text;
      $('firebaseDot').className = `dot ${kind}`;
    }

    function initMap() {
      if (map) return;
      map = L.map('map', { zoomControl: true }).setView([22.5, 78.9], 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
      }).addTo(map);
    }

    function initCharts() {
      if (gasChart) return;
      const common = {
        type: 'line',
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { ticks: { color: '#8294aa', maxTicksLimit: 5, font: { size: 9 } }, grid: { color: 'rgba(143,161,184,.08)' }, border: { display: false } },
            y: { ticks: { color: '#8294aa', maxTicksLimit: 5, font: { size: 9 } }, grid: { color: 'rgba(143,161,184,.08)' }, border: { display: false } }
          }
        }
      };
      const make = (canvas, label, color, fill = false) => new Chart($(canvas), {
        ...common,
        data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: fill ? color + '20' : color, fill, tension: .32, borderWidth: 2, pointRadius: 1.5, pointHoverRadius: 4 }] }
      });
      gasChart = make('gasChart', 'Gas ADC', '#f7bd55');
      tempChart = make('tempChart', 'Temperature', '#69a9ff');
      humidityChart = make('humidityChart', 'Humidity', '#49d69a');
    }

    function setMetric(id, value, unit, hint, dotClass = 'green') {
      $(id).innerHTML = `${value} <span class="metric-unit">${unit}</span>`;
      const prefix = id === 'gasValue' ? 'gas' : id === 'tempValue' ? 'temp' : id === 'humidityValue' ? 'humidity' : 'gps';
      $(`${prefix}Hint`).textContent = hint;
      $(`${prefix}Dot`).className = `dot ${dotClass}`;
    }

    function fmt(value, digits = 1) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(digits) : '--';
    }

    function timestampToDate(value) {
      if (typeof value === 'number') return new Date(value);
      if (value && typeof value === 'object' && typeof value['.sv'] === 'string') return null;
      return null;
    }

    function formatTime(value) {
      const date = timestampToDate(value);
      if (!date || Number.isNaN(date.getTime())) return 'Timestamp unavailable';
      return date.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function updateDeviceStatus(device = {}) {
      const stamp = Number(device.lastUpdate);
      const age = Number.isFinite(stamp) && stamp > 0 ? Date.now() - stamp : Infinity;
      const online = device.online === true && age < 20000;
      $('deviceStatus').textContent = online ? 'Helmet online' : 'Helmet offline';
      $('deviceDot').className = `dot ${online ? 'green' : 'red'}`;
      $('lastUpdate').textContent = Number.isFinite(stamp) && stamp > 0
        ? `${formatTime(stamp)} · ${Math.max(0, Math.round(age / 1000))}s ago`
        : 'No valid timestamp';
    }

    function updateLive(data) {
      latestLive = data || {};
      const sensors = latestLive.sensors || {};
      const gps = latestLive.gps || {};
      const alerts = latestLive.alerts || {};
      const device = latestLive.device || {};

      const gas = Number(sensors.gas);
      const gasValid = Number.isFinite(gas);
      setMetric('gasValue', gasValid ? Math.round(gas) : '--', 'ADC', gasValid ? (gas > 400 ? 'Above configured threshold' : 'Within configured threshold') : 'No sensor data', gasValid && gas > 400 ? 'red' : 'green');
      $('gasMeter').style.width = `${gasValid ? Math.max(0, Math.min(100, gas / 1023 * 100)) : 0}%`;
      $('gasMeter').style.background = gas > 400 ? 'var(--red)' : 'var(--green)';

      const temperature = Number(sensors.temperature);
      const tempValid = sensors.temperatureValid !== false && Number.isFinite(temperature);
      setMetric('tempValue', tempValid ? fmt(temperature, 1) : '--', '°C', tempValid ? (temperature > 35 ? 'Above configured threshold' : 'DHT11 reading') : 'DHT11 reading invalid', tempValid && temperature > 35 ? 'red' : 'green');
      $('tempMeter').style.width = `${tempValid ? Math.max(0, Math.min(100, temperature / 60 * 100)) : 0}%`;
      $('tempMeter').style.background = tempValid && temperature > 35 ? 'var(--red)' : 'var(--blue)';

      const humidity = Number(sensors.humidity);
      const humValid = sensors.humidityValid !== false && Number.isFinite(humidity);
      setMetric('humidityValue', humValid ? fmt(humidity, 1) : '--', '%', humValid ? 'DHT11 relative humidity' : 'DHT11 reading invalid', 'green');
      $('humidityMeter').style.width = `${humValid ? Math.max(0, Math.min(100, humidity)) : 0}%`;

      const sats = Number(gps.satellites);
      $('satelliteValue').innerHTML = `${Number.isFinite(sats) ? sats : '--'} <span class="metric-unit">SAT</span>`;
      $('gpsHint').textContent = gps.gpsFix ? 'Valid position received' : 'Waiting for valid GPS fix';
      $('gpsDot').className = `dot ${gps.gpsFix ? 'green' : ''}`;
      $('gpsMeter').style.width = `${gps.gpsFix ? Math.min(100, sats / 12 * 100) : 0}%`;

      $('latitude').textContent = gps.gpsFix ? fmt(gps.latitude, 6) : '--';
      $('longitude').textContent = gps.gpsFix ? fmt(gps.longitude, 6) : '--';
      $('altitude').textContent = gps.gpsFix ? `${fmt(gps.altitude, 1)} m` : '-- m';
      $('speed').textContent = gps.gpsFix ? `${fmt(gps.speed, 1)} km/h` : '-- km/h';
      $('satellites').textContent = Number.isFinite(sats) ? String(sats) : '--';
      $('hdop').textContent = gps.gpsFix ? fmt(gps.hdop, 1) : '--';
      $('gpsState').textContent = gps.gpsFix ? 'GPS FIX' : 'NO FIX';
      $('gpsState').className = `state ${gps.gpsFix ? '' : 'warn'}`;
      $('mapOverlay').textContent = gps.gpsFix ? `${fmt(gps.latitude, 6)}, ${fmt(gps.longitude, 6)}` : 'Waiting for valid GPS coordinates';

      if (gps.gpsFix && Number.isFinite(Number(gps.latitude)) && Number.isFinite(Number(gps.longitude))) {
        const latlng = [Number(gps.latitude), Number(gps.longitude)];
        if (!marker) {
          marker = L.marker(latlng).addTo(map).bindPopup('Smart Mining Helmet');
          map.setView(latlng, 16);
        } else {
          marker.setLatLng(latlng);
          if (map.getZoom() < 10) map.setView(latlng, 16);
        }
        marker.bindPopup(`<b>Mining Helmet</b><br>${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}<br>Satellites: ${Number.isFinite(sats) ? sats : '--'}`);
        $('mapOverlay').textContent = `GPS FIX · ${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
      }

      const gasAlert = alerts.gasAlert === true;
      const tempAlert = alerts.highTempAlert === true;
      const alarm = alerts.autoAlarm === true;
      $('gasAlertState').textContent = gasAlert ? 'ALERT' : 'NORMAL';
      $('gasAlertState').className = `state ${gasAlert ? 'bad' : ''}`;
      $('tempAlertState').textContent = tempAlert ? 'ALERT' : 'NORMAL';
      $('tempAlertState').className = `state ${tempAlert ? 'bad' : ''}`;
      $('autoBuzzerState').textContent = alarm ? 'ON' : 'OFF';
      $('autoBuzzerState').className = `state ${alarm ? 'bad' : ''}`;

      const status = String(alerts.status || (alarm ? 'ALERT' : 'NORMAL')).replaceAll('_', ' ');
      $('overallStatus').textContent = status;
      $('overallDetail').textContent = alarm ? 'One or more configured safety thresholds have been exceeded.' : 'No active configured gas or temperature alert.';
      $('statusSymbol').textContent = alarm ? '!' : '✓';
      $('statusSymbol').style.color = alarm ? 'var(--red)' : 'var(--green)';
      $('statusSymbol').style.background = alarm ? 'rgba(255,107,114,.12)' : 'var(--green-dim)';

      updateDeviceStatus(device);
    }

    function normalizeHistory(raw) {
      if (!raw || typeof raw !== 'object') return [];
      return Object.entries(raw).map(([key, value]) => ({ key, ...(value || {}) }))
        .sort((a, b) => String(a.key).localeCompare(String(b.key)))
        .slice(-60);
    }

    function updateCharts(records) {
      initCharts();
      const labels = records.map((row) => {
        const t = row.device?.lastUpdate;
        const date = timestampToDate(t);
        return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      });
      const gas = records.map((row) => Number.isFinite(Number(row.sensors?.gas)) ? Number(row.sensors.gas) : null);
      const temperature = records.map((row) => row.sensors?.temperatureValid === false ? null : Number.isFinite(Number(row.sensors?.temperature)) ? Number(row.sensors.temperature) : null);
      const humidity = records.map((row) => row.sensors?.humidityValid === false ? null : Number.isFinite(Number(row.sensors?.humidity)) ? Number(row.sensors.humidity) : null);
      for (const [chart, values] of [[gasChart, gas], [tempChart, temperature], [humidityChart, humidity]]) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = values;
        chart.update('none');
      }
    }

    function renderHistory() {
      $('historyCount').textContent = `${historyRecords.length} records`;
      const tbody = $('historyRows');
      if (!historyRecords.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">No historical records found yet. The helmet sketch adds a record every 10 seconds.</td></tr>';
        return;
      }
      const latest = historyRecords.slice().reverse().slice(0, 10);
      tbody.innerHTML = latest.map((row) => {
        const date = formatTime(row.device?.lastUpdate);
        const gas = row.sensors?.gas ?? '--';
        const temp = row.sensors?.temperatureValid === false ? '--' : fmt(row.sensors?.temperature, 1);
        const humidity = row.sensors?.humidityValid === false ? '--' : fmt(row.sensors?.humidity, 1);
        const gpsFix = row.gps?.gpsFix ? 'YES' : 'NO';
        const status = String(row.alerts?.status || 'UNKNOWN').replaceAll('_', ' ');
        const isAlert = row.alerts?.autoAlarm === true;
        return `<tr><td>${escapeHtml(date)}</td><td>${escapeHtml(String(gas))}</td><td>${escapeHtml(temp)}</td><td>${escapeHtml(humidity)}</td><td>${gpsFix}</td><td><span class="state ${isAlert ? 'bad' : ''}">${escapeHtml(status)}</span></td></tr>`;
      }).join('');
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    }

    function startRealtimeListeners() {
      stopRealtimeListeners();
      setConnection('green', 'Firebase connected');
      initMap();
      initCharts();
      setTimeout(() => map?.invalidateSize(), 150);

      liveUnsub = onValue(ref(db, 'MiningHelmet/live'), (snapshot) => {
        const data = snapshot.val();
        if (data) updateLive(data);
        else toast('Connected to Firebase, but /MiningHelmet/live has no data yet.');
      }, (error) => {
        setConnection('red', 'Database read denied');
        toast(`Live data read failed: ${error.message}`);
      });

      const historyQuery = query(ref(db, 'MiningHelmet/history'), orderByKey(), limitToLast(60));
      historyUnsub = onValue(historyQuery, (snapshot) => {
        historyRecords = normalizeHistory(snapshot.val());
        renderHistory();
        updateCharts(historyRecords);
      }, (error) => {
        toast(`History read failed: ${error.message}`);
      });

      commandUnsub = onValue(ref(db, 'MiningHelmet/commands/dashboardBuzzer'), (snapshot) => {
        const value = snapshot.val();
        const isOn = value === true;
        $('buzzerToggle').checked = isOn;
        $('buzzerToggle').disabled = false;
        $('buzzerStateText').textContent = `Command stored in Firebase: ${isOn ? 'ON' : 'OFF'}. The helmet polls this command about every 3 seconds.`;
      }, (error) => {
        $('buzzerToggle').disabled = true;
        $('buzzerStateText').textContent = `Cannot read buzzer command: ${error.message}`;
        toast(`Buzzer command read failed: ${error.message}`);
      });
    }

    function stopRealtimeListeners() {
      if (liveUnsub) liveUnsub();
      if (historyUnsub) historyUnsub();
      if (commandUnsub) commandUnsub();
      liveUnsub = historyUnsub = commandUnsub = null;
    }

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      loginError.textContent = '';
      loginButton.disabled = true;
      loginButton.textContent = 'Signing in…';
      try {
        const email = $('email').value.trim();
        const password = $('password').value;
        await signInWithEmailAndPassword(auth, email, password);
      } catch (error) {
        loginError.textContent = friendlyError(error);
      } finally {
        loginButton.disabled = false;
        loginButton.textContent = 'Connect to dashboard';
      }
    });

    $('logoutButton').addEventListener('click', async () => {
      stopRealtimeListeners();
      await signOut(auth);
    });

    $('buzzerToggle').addEventListener('change', async (event) => {
      const desired = event.target.checked;
      event.target.disabled = true;
      $('buzzerStateText').textContent = 'Sending command to Firebase…';
      try {
        await set(ref(db, 'MiningHelmet/commands/dashboardBuzzer'), desired);
        $('buzzerStateText').textContent = `Command saved: ${desired ? 'ON' : 'OFF'}. Waiting for helmet to read it.`;
        toast(`Dashboard buzzer command set to ${desired ? 'ON' : 'OFF'}.`);
      } catch (error) {
        event.target.checked = !desired;
        $('buzzerStateText').textContent = `Command failed: ${error.message}`;
        toast(`Could not change buzzer: ${error.message}`);
      } finally {
        event.target.disabled = false;
      }
    });

    $('exportButton').addEventListener('click', () => {
      if (!historyRecords.length) { toast('There are no history records to export yet.'); return; }
      const rows = [['time','gas_adc','temperature_c','humidity_percent','gps_fix','latitude','longitude','status']];
      for (const row of historyRecords) {
        rows.push([
          formatTime(row.device?.lastUpdate),
          row.sensors?.gas ?? '',
          row.sensors?.temperatureValid === false ? '' : row.sensors?.temperature ?? '',
          row.sensors?.humidityValid === false ? '' : row.sensors?.humidity ?? '',
          row.gps?.gpsFix ? 'true' : 'false',
          row.gps?.latitude ?? '',
          row.gps?.longitude ?? '',
          row.alerts?.status ?? ''
        ]);
      }
      const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'mining-helmet-history.csv'; a.click(); URL.revokeObjectURL(url);
    });

    onAuthStateChanged(auth, (user) => {
      if (user) {
        loginLayer.classList.add('hidden');
        $('userEmail').textContent = user.email || 'Authenticated';
        startRealtimeListeners();
        loginError.textContent = '';
      } else {
        stopRealtimeListeners();
        loginLayer.classList.remove('hidden');
        $('userEmail').textContent = 'Signed out';
        $('buzzerToggle').checked = false;
        $('buzzerToggle').disabled = true;
        setConnection('', 'Firebase disconnected');
      }
    });
