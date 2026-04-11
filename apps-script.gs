// ============================================================
// FleetOps — Google Apps Script Web App
// Deploy as: Execute as Me | Anyone (even anonymous) can access
// ============================================================

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// ── Sheet names ──────────────────────────────────────────────
const SHEETS = {
  drivers:      'Drivers',
  vehicles:     'Vehicles',
  customers:    'Customers',
  locations:    'Locations',
  bookings:     'Bookings',
  trips:        'Trips',
  expenses:     'Expenses',
  transporters: 'Transporters',
  settings:     'Settings',
};

// ── CORS helper ──────────────────────────────────────────────
function cors(output) {
  return output
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
}

function ok(data, callback) {
  const json = JSON.stringify({ ok: true, data });
  if (callback) {
    // JSONP response — wraps JSON in the callback function call
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return cors(ContentService.createTextOutput(json));
}

function err(msg, callback) {
  const json = JSON.stringify({ ok: false, error: msg });
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return cors(ContentService.createTextOutput(json));
}

// ── Entry points ─────────────────────────────────────────────
function doGet(e) {
  const callback = e.parameter.callback || null;
  try {
    // ── Tunnelled POST via JSONP GET ──────────────────────────────
    // The browser can't POST cross-origin to Apps Script, so we tunnel
    // POST data as GET params: method=POST&payload=<json>&callback=fn
    if (e.parameter.method === 'POST') {
      const body = JSON.parse(e.parameter.payload || '{}');
      return routePost(body, callback);
    }

    // ── Normal GET actions ────────────────────────────────────────
    const action = e.parameter.action || '';
    switch (action) {
      case 'getMasterData':   return ok(getMasterData(), callback);
      case 'getBookings':     return ok(getSheetData(SHEETS.bookings), callback);
      case 'getTrips':        return ok(getTripsEnriched(), callback);
      case 'getExpenses':     return ok(getSheetData(SHEETS.expenses), callback);
      case 'getTransporters': return ok(getSheetData(SHEETS.transporters), callback);
      case 'getDashboard':    return ok(getDashboardStats(), callback);
      case 'getAlerts':       return ok(getAlerts(), callback);
      case 'suggestVehicles':
        return ok(suggestVehicles(e.parameter.bookingId, e.parameter.pickupLocation), callback);
      default:
        return err('Unknown action: ' + action, callback);
    }
  } catch(ex) {
    return err(ex.toString(), callback);
  }
}

// Route tunnelled POST actions
function routePost(body, callback) {
  try {
    const action = body.action || '';
    switch (action) {
      case 'createBooking':    return ok(createBooking(body.data), callback);
      case 'assignVehicle':    return ok(assignVehicle(body.data), callback);
      case 'updateTripStatus': return ok(updateTripStatus(body.data), callback);
      case 'saveExpenses':     return ok(saveExpenses(body.data), callback);
      case 'createTransporter':return ok(appendRow(SHEETS.transporters, body.data), callback);
      default:
        return err('Unknown POST action: ' + action, callback);
    }
  } catch(ex) {
    return err(ex.toString(), callback);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || '';
    switch (action) {
      case 'createBooking':    return ok(createBooking(body.data));
      case 'assignVehicle':    return ok(assignVehicle(body.data));
      case 'updateTripStatus': return ok(updateTripStatus(body.data));
      case 'saveExpenses':     return ok(saveExpenses(body.data));
      case 'createTransporter':return ok(appendRow(SHEETS.transporters, body.data));
      default:
        return err('Unknown action: ' + action);
    }
  } catch(ex) {
    return err(ex.toString());
  }
}

// Handle preflight OPTIONS (Apps Script doesn't natively, but some clients send it)
function doOptions(e) {
  return cors(ContentService.createTextOutput(''));
}

// ── Sheet helpers ─────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function getSheetData(name) {
  const sh = getSheet(name);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function appendRow(sheetName, obj) {
  const sh = getSheet(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  sh.appendRow(row);
  return { inserted: true, id: obj.id || '' };
}

function updateRow(sheetName, idField, idValue, updates) {
  const sh = getSheet(sheetName);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const idCol = headers.indexOf(idField);
  if (idCol === -1) return { updated: false, error: 'idField not found' };
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(idValue)) {
      Object.keys(updates).forEach(key => {
        const col = headers.indexOf(key);
        if (col !== -1) sh.getRange(r + 1, col + 1).setValue(updates[key]);
      });
      return { updated: true };
    }
  }
  return { updated: false, error: 'Row not found' };
}

// ── ID generator ─────────────────────────────────────────────
function newId(prefix) {
  return prefix + '-' + Date.now().toString(36).toUpperCase();
}

function nowISO() {
  return new Date().toISOString();
}

// ── Master data (dropdowns) ──────────────────────────────────
function getMasterData() {
  return {
    drivers:      getSheetData(SHEETS.drivers),
    vehicles:     getSheetData(SHEETS.vehicles),
    customers:    getSheetData(SHEETS.customers),
    locations:    getSheetData(SHEETS.locations),
    transporters: getSheetData(SHEETS.transporters),
  };
}

// ── Bookings ─────────────────────────────────────────────────
function createBooking(data) {
  const id = newId('BK');
  const row = {
    id,
    containerNumber: data.containerNumber || '',
    containerType:   data.containerType   || '',
    customerId:      data.customerId       || '',
    customerName:    data.customerName     || '',
    pickupLocation:  data.pickupLocation   || '',
    deliveryLocation:data.deliveryLocation || '',
    agreedRate:      Number(data.agreedRate) || 0,
    etaDate:         data.etaDate          || '',
    status:          'Pending',
    createdAt:       nowISO(),
    notes:           data.notes            || '',
  };
  appendRow(SHEETS.bookings, row);
  return { id, booking: row };
}

// ── Vehicle suggestion engine ────────────────────────────────
function suggestVehicles(bookingId, pickupLocation) {
  const vehicles = getSheetData(SHEETS.vehicles);
  const trips    = getSheetData(SHEETS.trips);

  // Build last-trip map per vehicle
  const lastTrip = {};
  trips.forEach(t => {
    const v = t.vehicleId;
    if (!lastTrip[v] || new Date(t.updatedAt) > new Date(lastTrip[v].updatedAt)) {
      lastTrip[v] = t;
    }
  });

  const scored = vehicles
    .filter(v => v.status === 'Available' || v.status === '')
    .map(v => {
      const lt = lastTrip[v.id];
      let score = 100;
      let reasons = [];

      // Penalise if last trip ended far from pickup
      if (lt && lt.deliveryLocation) {
        if (lt.deliveryLocation === pickupLocation) {
          score += 20; reasons.push('At pickup location');
        } else {
          score -= 10; reasons.push('Last trip: ' + lt.deliveryLocation);
        }
      }

      // Penalise long idle time
      const idleHours = lt
        ? (Date.now() - new Date(lt.updatedAt).getTime()) / 3600000
        : 999;
      if (idleHours > 24)  { score -= 20; reasons.push('Idle ' + Math.round(idleHours) + 'h'); }
      else if (idleHours < 2) { score -= 5; reasons.push('Just returned'); }
      else { reasons.push('Idle ' + Math.round(idleHours) + 'h'); }

      // Bonus for matching vehicle type (basic heuristic)
      if (v.type && v.type.includes('40')) score += 5;

      score = Math.max(10, Math.min(100, score));

      return {
        ...v,
        score,
        idleHours: Math.round(idleHours),
        reasons,
        lastLocation: lt ? lt.deliveryLocation : (v.baseLocation || 'Unknown'),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored;
}

// ── Vehicle assignment ────────────────────────────────────────
function assignVehicle(data) {
  // Update booking status
  updateRow(SHEETS.bookings, 'id', data.bookingId, {
    status:    'Assigned',
    vehicleId: data.vehicleId,
    driverId:  data.driverId,
    updatedAt: nowISO(),
  });

  // Create trip
  const tripId = newId('TRP');
  const booking = getSheetData(SHEETS.bookings).find(b => b.id === data.bookingId) || {};
  const trip = {
    id:              tripId,
    bookingId:       data.bookingId,
    containerNumber: booking.containerNumber || data.containerNumber || '',
    containerType:   booking.containerType   || '',
    customerId:      booking.customerId      || '',
    customerName:    booking.customerName    || '',
    vehicleId:       data.vehicleId,
    vehicleReg:      data.vehicleReg         || '',
    driverId:        data.driverId,
    driverName:      data.driverName         || '',
    pickupLocation:  booking.pickupLocation  || data.pickupLocation || '',
    deliveryLocation:booking.deliveryLocation|| data.deliveryLocation || '',
    agreedRate:      booking.agreedRate       || 0,
    status:          'Assigned',
    yardEntryDate:   data.yardEntryDate       || '',
    freeDays:        Number(data.freeDays) || 4,
    createdAt:       nowISO(),
    updatedAt:       nowISO(),
    notes:           data.notes || '',
  };
  appendRow(SHEETS.trips, trip);

  // Mark vehicle as On Trip
  updateRow(SHEETS.vehicles, 'id', data.vehicleId, {
    status: 'On Trip',
    currentTripId: tripId,
  });

  return { tripId, trip };
}

// ── Trip status update ────────────────────────────────────────
const TRIP_STAGES = ['Assigned','Pickup','Loaded','Transit','Delivered','Return','Closed'];

function updateTripStatus(data) {
  const updates = {
    status:    data.status,
    updatedAt: nowISO(),
  };
  if (data.status === 'Closed') {
    // Free up vehicle
    updateRow(SHEETS.vehicles, 'id', data.vehicleId, {
      status: 'Available',
      currentTripId: '',
    });
  }
  if (data.notes) updates.notes = data.notes;
  const res = updateRow(SHEETS.trips, 'id', data.tripId, updates);
  return res;
}

// ── Enriched trips (joins vehicle + driver name) ──────────────
function getTripsEnriched() {
  const trips    = getSheetData(SHEETS.trips);
  const vehicles = getSheetData(SHEETS.vehicles);
  const drivers  = getSheetData(SHEETS.drivers);
  const expenses = getSheetData(SHEETS.expenses);

  const vMap = {}; vehicles.forEach(v => vMap[v.id] = v);
  const dMap = {}; drivers.forEach(d => dMap[d.id] = d);

  // Sum expenses per trip
  const expMap = {};
  expenses.forEach(e => {
    const tid = e.tripId;
    if (!expMap[tid]) expMap[tid] = 0;
    expMap[tid] += Number(e.totalCost) || 0;
  });

  return trips.map(t => ({
    ...t,
    vehicle: vMap[t.vehicleId] || {},
    driver:  dMap[t.driverId]  || {},
    totalExpenses: expMap[t.id] || 0,
    profit: (Number(t.agreedRate) || 0) - (expMap[t.id] || 0),
  }));
}

// ── Expenses ─────────────────────────────────────────────────
function saveExpenses(data) {
  const id = newId('EXP');
  const dieselCost  = (Number(data.dieselLitres) || 0) * (Number(data.dieselRate) || 0);
  const labourCost  = (Number(data.loadingCost) || 0) + (Number(data.unloadingCost) || 0);
  const totalCost   = dieselCost
    + (Number(data.tolls) || 0)
    + (Number(data.driverCash) || 0)
    + labourCost
    + (Number(data.otherCost) || 0);

  const row = {
    id,
    tripId:         data.tripId,
    dieselLitres:   Number(data.dieselLitres)  || 0,
    dieselRate:     Number(data.dieselRate)     || 0,
    dieselCost,
    tolls:          Number(data.tolls)          || 0,
    driverCash:     Number(data.driverCash)     || 0,
    loadingCost:    Number(data.loadingCost)    || 0,
    unloadingCost:  Number(data.unloadingCost)  || 0,
    otherCost:      Number(data.otherCost)      || 0,
    totalCost,
    notes:          data.notes || '',
    createdAt:      nowISO(),
  };
  appendRow(SHEETS.expenses, row);

  // Update trip with latest cost snapshot
  updateRow(SHEETS.trips, 'id', data.tripId, {
    latestExpenses: totalCost,
    updatedAt: nowISO(),
  });

  return { id, totalCost, dieselCost, labourCost };
}

// ── Dashboard stats ──────────────────────────────────────────
function getDashboardStats() {
  const trips    = getTripsEnriched();
  const today    = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const activeTrips = trips.filter(t =>
    !['Closed','Delivered'].includes(t.status)
  );

  const mtdTrips = trips.filter(t =>
    new Date(t.createdAt) >= monthStart
  );

  const mtdRevenue = mtdTrips.reduce((s, t) => s + (Number(t.agreedRate) || 0), 0);
  const mtdProfit  = mtdTrips.reduce((s, t) => s + (t.profit || 0), 0);

  const todayTrips = trips.filter(t => {
    const d = new Date(t.createdAt);
    return d.toDateString() === today.toDateString();
  });
  const todayRevenue = todayTrips.reduce((s, t) => s + (Number(t.agreedRate) || 0), 0);

  return {
    activeTrips: activeTrips.length,
    todayRevenue,
    mtdRevenue,
    mtdProfit,
    mtdMargin: mtdRevenue ? Math.round((mtdProfit / mtdRevenue) * 100) : 0,
    totalTrips: trips.length,
    avgProfit: trips.length
      ? Math.round(trips.reduce((s,t) => s + (t.profit||0), 0) / trips.length)
      : 0,
    recentTrips: trips.slice(-20).reverse(),
  };
}

// ── Smart alerts ─────────────────────────────────────────────
function getAlerts() {
  const trips    = getTripsEnriched();
  const vehicles = getSheetData(SHEETS.vehicles);
  const alerts   = [];
  const now      = Date.now();

  // 1. Detention risk: containers in yard > (freeDays - 1 day)
  trips
    .filter(t => t.yardEntryDate && !['Delivered','Closed'].includes(t.status))
    .forEach(t => {
      const entryMs  = new Date(t.yardEntryDate).getTime();
      const freeMs   = (Number(t.freeDays) || 4) * 86400000;
      const elapsed  = now - entryMs;
      const remaining = freeMs - elapsed;
      if (remaining < 86400000 && remaining > 0) {
        alerts.push({
          type: 'danger',
          title: 'Detention Risk: ' + t.containerNumber,
          message: 'Free days expire in ' + Math.round(remaining / 3600000) + 'h. Act now.',
          tripId: t.id,
        });
      } else if (remaining <= 0) {
        alerts.push({
          type: 'danger',
          title: 'Detention Active: ' + t.containerNumber,
          message: 'Detention started ' + Math.abs(Math.round(remaining / 3600000)) + 'h ago.',
          tripId: t.id,
        });
      }
    });

  // 2. Idle vehicles
  const onTripIds = new Set(
    trips.filter(t => !['Closed','Delivered'].includes(t.status)).map(t => t.vehicleId)
  );
  vehicles
    .filter(v => !onTripIds.has(v.id))
    .forEach(v => {
      // Find last completed trip
      const last = trips
        .filter(t => t.vehicleId === v.id && ['Closed','Delivered'].includes(t.status))
        .sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
      if (last) {
        const idleH = Math.round((now - new Date(last.updatedAt).getTime()) / 3600000);
        if (idleH > 12) {
          alerts.push({
            type: 'warn',
            title: 'Vehicle Idle: ' + v.registrationNumber,
            message: 'Idle for ' + idleH + 'h. Estimated revenue loss: ₹' +
              Math.round(idleH * 800).toLocaleString('en-IN'),
            vehicleId: v.id,
          });
        }
      }
    });

  // 3. Cost overruns
  trips
    .filter(t => t.totalExpenses > 0 && t.agreedRate > 0)
    .forEach(t => {
      const expRatio = t.totalExpenses / t.agreedRate;
      if (expRatio > 0.85) {
        alerts.push({
          type: 'warn',
          title: 'Cost Overrun: ' + (t.id || ''),
          message: 'Expenses at ' + Math.round(expRatio * 100) + '% of revenue. Margin squeezed.',
          tripId: t.id,
        });
      }
    });

  return alerts;
}

// ── Bootstrap: set up sheets with headers if missing ─────────
function bootstrapSheets() {
  const schema = {
    Drivers: ['id','name','phone','licenseNumber','experienceYears','baseLocation','status','createdAt'],
    Vehicles: ['id','registrationNumber','type','capacity','ownerType','ownerId','baseLocation','status','currentTripId','createdAt'],
    Customers: ['id','name','contactName','phone','email','address','gstNumber','createdAt'],
    Locations: ['id','name','type','city','pincode','portCode','notes'],
    Bookings: ['id','containerNumber','containerType','customerId','customerName','pickupLocation','deliveryLocation','agreedRate','etaDate','status','vehicleId','driverId','createdAt','updatedAt','notes'],
    Trips: ['id','bookingId','containerNumber','containerType','customerId','customerName','vehicleId','vehicleReg','driverId','driverName','pickupLocation','deliveryLocation','agreedRate','status','yardEntryDate','freeDays','latestExpenses','createdAt','updatedAt','notes'],
    Expenses: ['id','tripId','dieselLitres','dieselRate','dieselCost','tolls','driverCash','loadingCost','unloadingCost','otherCost','totalCost','notes','createdAt'],
    Transporters: ['id','name','contactName','phone','type','balance','createdAt'],
    Settings: ['key','value'],
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(schema).forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length)
        .setBackground('#1a1a2e')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });

  // Seed sample data
  seedSampleData();

  SpreadsheetApp.getUi().alert('✅ FleetOps sheets bootstrapped successfully!');
}

function seedSampleData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Seed Drivers
  const dsh = ss.getSheetByName('Drivers');
  if (dsh.getLastRow() < 2) {
    const drivers = [
      ['DRV-001','Rajan Kumar','9876543210','TN-0124-5678901',8,'Kattupalli','Available',nowISO()],
      ['DRV-002','Suresh Pillai','9876543211','AP-0524-1234567',5,'Chennai Port','Available',nowISO()],
      ['DRV-003','Murugan Vel','9876543212','TN-1221-9876543',11,'Manali','Available',nowISO()],
    ];
    dsh.getRange(2, 1, drivers.length, drivers[0].length).setValues(drivers);
  }

  // Seed Vehicles
  const vsh = ss.getSheetByName('Vehicles');
  if (vsh.getLastRow() < 2) {
    const vehicles = [
      ['VEH-001','TN05 GH 4421','32T Trailer',32000,'Own','','Kattupalli','Available','',nowISO()],
      ['VEH-002','AP28 CD 7723','20T Truck',20000,'Own','','Chennai Port','Available','',nowISO()],
      ['VEH-003','TN09 AK 2211','40T Trailer',40000,'Own','','Manali','Available','',nowISO()],
    ];
    vsh.getRange(2, 1, vehicles.length, vehicles[0].length).setValues(vehicles);
  }

  // Seed Customers
  const csh = ss.getSheetByName('Customers');
  if (csh.getLastRow() < 2) {
    const customers = [
      ['CUST-001','TVS Logistics','Ramesh T','9900112233','ramesh@tvs.com','Chennai','33AAACT1234A1Z5',nowISO()],
      ['CUST-002','Mahindra','Priya S','9900112234','priya@mahindra.com','Oragadam','33AAACM5678B1Z2',nowISO()],
      ['CUST-003','Saint-Gobain','Anand K','9900112235','anand@sg.com','Sriperumbudur','33AAACS9012C1Z8',nowISO()],
    ];
    csh.getRange(2, 1, customers.length, customers[0].length).setValues(customers);
  }

  // Seed Locations
  const lsh = ss.getSheetByName('Locations');
  if (lsh.getLastRow() < 2) {
    const locs = [
      ['LOC-001','Kattupalli Port','Port','Chennai','600120','INKTP','Major port'],
      ['LOC-002','Chennai Port','Port','Chennai','600001','INMAA','CMNPT'],
      ['LOC-003','Mahindra City','Factory','Chennai','603002','',''],
      ['LOC-004','SIPCOT Oragadam','Industrial','Chennai','602105','',''],
      ['LOC-005','Sriperumbudur','Industrial','Chennai','602105','',''],
    ];
    lsh.getRange(2, 1, locs.length, locs[0].length).setValues(locs);
  }

  // Seed Transporters
  const tsh = ss.getSheetByName('Transporters');
  if (tsh.getLastRow() < 2) {
    const trans = [
      ['TRANS-001','Sri Murugan Transport','Murugan','9811223344','Partner',0,nowISO()],
      ['TRANS-002','Kaveri Logistics','Kavitha','9811223355','Partner',0,nowISO()],
    ];
    tsh.getRange(2, 1, trans.length, trans[0].length).setValues(trans);
  }
}

// Run bootstrapSheets() once from the Apps Script editor after deploying.
