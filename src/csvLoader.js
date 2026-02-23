import Papa from 'papaparse';

const EARTH_RADIUS_MILES = 3958.8;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

function isValidCoord(val) {
  if (val == null) return false;
  const v = String(val).trim();
  return v && v.toUpperCase() !== 'NULL' && v !== 'N/A';
}

export async function loadJourneys() {
  const base = import.meta.env.BASE_URL || '/';
  const res = await fetch(`${base}SBX26_Metrics - 2_7.csv`);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  const hometownLatKey = 'Hometown Lat ' in (rows[0] || {}) ? 'Hometown Lat ' : 'Hometown Lat';
  const hometownLonKey = 'Hometown Lon';

  const filtered = rows.filter((row) => {
    const userType = String(row.userType || '').trim();
    const activation = String(row.activation || '').trim();
    if (userType === 'GUEST') return false;
    if (activation.toLowerCase().includes('photobooth')) return false;
    if (!isValidCoord(row[hometownLatKey]) || !isValidCoord(row[hometownLonKey])) return false;
    if (!isValidCoord(row.dreamLat) || !isValidCoord(row.dreamLon)) return false;
    return true;
  });

  return filtered.map((row) => {
    const startLat = parseFloat(row[hometownLatKey]);
    const startLng = parseFloat(row[hometownLonKey]);
    const endLat = parseFloat(row.dreamLat);
    const endLng = parseFloat(row.dreamLon);
    const distance = haversineDistance(startLat, startLng, endLat, endLng);
    const city = String(row.city || '').trim();
    const displayCity = city && city !== 'NULL' ? city : 'Unknown';

    const dateStr = String(row.Date || '').trim();
    let activationDay = null;
    if (dateStr) {
      const parts = dateStr.split('/');
      if (parts.length >= 2 && parts[1]) {
        const day = parseInt(parts[1], 10);
        if (day >= 3 && day <= 7) activationDay = day;
      }
    }

    return {
      startLat,
      startLng,
      endLat,
      endLng,
      dreamHomeName: String(row.dreamHomeLocationName || '').trim(),
      distance,
      firstName: String(row.firstName || '').trim(),
      lastName: String(row.lastName || '').trim(),
      email: String(row.email || '').trim(),
      scoreCreatedOn: String(row.scoreCreatedOn || '').trim(),
      city: displayCity,
      activationDay,
    };
  });
}
