const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-Memory Database (Initialised with realistic Trossachs wildfire scenario data)
let db = {
  events: [
    {
      id: "evt-001",
      title: "Rapid wildfire spread near Aberfoyle",
      description: "High winds driving fire towards woodland fringe. Evacuation advisory recommended.",
      location: { name: "Aberfoyle Forest Edge", lat: 56.1833, lng: -4.3833, sector: "Sector A - Callander" },
      severity: "Critical",
      status: "Active",
      department: "Scottish Fire and Rescue Service",
      authorName: "Station Officer MacLeod",
      authorRole: "Incident Commander",
      timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
      updates: [
        { author: "Ranger John", department: "National Park Rangers", text: "Visitor car park cleared.", timestamp: new Date(Date.now() - 5 * 60000).toISOString() }
      ]
    },
    {
      id: "evt-002",
      title: "Campsite unattended / campfire hazard",
      description: "Unattended campfire reported near Loch Venachar trail. Dry peat risk.",
      location: { name: "Loch Venachar Trail Head", lat: 56.2300, lng: -4.2500, sector: "Sector B - Trossachs East" },
      severity: "High",
      status: "Decision Pending",
      department: "National Park Rangers",
      authorName: "Ranger Sarah",
      authorRole: "Senior Ranger",
      timestamp: new Date(Date.now() - 35 * 60000).toISOString(),
      updates: []
    },
    {
      id: "evt-003",
      title: "Water tanker staging established",
      description: "Primary water supply drop set up at Brig o' Turk junction for fire engines.",
      location: { name: "Brig o' Turk", lat: 56.2167, lng: -4.3167, sector: "Sector B - Trossachs East" },
      severity: "Moderate",
      status: "Active",
      department: "Scottish Fire and Rescue Service",
      authorName: "Firefighter Dunn",
      authorRole: "Logistics Lead",
      timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
      updates: []
    }
  ],
  sectors: [
    { id: "sec-a", name: "Sector A - Callander", status: "Active Fire", fireStation: "Callander Station", activeFires: 1 },
    { id: "sec-b", name: "Sector B - Trossachs East", status: "Fire Watch", fireStation: "Brig o' Turk Unit", activeFires: 0 },
    { id: "sec-c", name: "Sector C - Loch Lomond North", status: "Normal", fireStation: "Ardlui Station", activeFires: 0 }
  ],
  resources: [
    { id: "res-1", name: "Fire Engine Unit 4", department: "Scottish Fire and Rescue Service", lat: 56.1900, lng: -4.3700, status: "En-route" },
    { id: "res-2", name: "Ranger Patrol 2", department: "National Park Rangers", lat: 56.2250, lng: -4.2600, status: "Active" }
  ],
  weather: {
    condition: "High Dry Risk / Strong Gusts",
    temperature: "21°C",
    wind: "28mph NW",
    warning: "Amber Wildfire Warning - Extreme Caution Advised"
  }
};

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all events with optional filters (?department=&severity=&status=&sector=)
app.get('/api/events', (req, res) => {
  let filtered = [...db.events];
  const { department, severity, status, sector } = req.query;

  if (department) filtered = filtered.filter(e => e.department === department);
  if (severity) filtered = filtered.filter(e => e.severity === severity);
  if (status) filtered = filtered.filter(e => e.status === status);
  if (sector) filtered = filtered.filter(e => e.location.sector === sector);

  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(filtered);
});

// Quick Add Event
app.post('/api/events', (req, res) => {
  const { title, description, locationName, lat, lng, sector, severity, department, authorName, authorRole } = req.body;
  
  if (!title || !department || !severity) {
    return res.status(400).json({ error: 'Missing required fields: title, department, severity' });
  }

  const newEvent = {
    id: `evt-${Date.now().toString().slice(-4)}`,
    title,
    description: description || '',
    location: {
      name: locationName || 'Unknown Location',
      lat: lat ? parseFloat(lat) : 56.2000,
      lng: lng ? parseFloat(lng) : -4.3000,
      sector: sector || 'Sector A - Callander'
    },
    severity,
    status: 'Active',
    department,
    authorName: authorName || 'Anonymous Operator',
    authorRole: authorRole || 'Field Unit',
    timestamp: new Date().toISOString(),
    updates: []
  };

  db.events.unshift(newEvent);

  io.emit('event_added', newEvent);
  io.emit('timeline_updated', db.events);

  res.status(201).json(newEvent);
});

// Update event / Add audit log / Change status
app.put('/api/events/:id', (req, res) => {
  const event = db.events.find(item => item.id === req.params.id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const { status, severity, actionRequired, updateText, author, department } = req.body;

  const allowedStatuses = ['Active', 'Decision Pending', 'Resolved'];
  const allowedSeverities = ['Low', 'Moderate', 'High', 'Critical'];

  if (status !== undefined && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid incident status' });
  }

  if (severity !== undefined && !allowedSeverities.includes(severity)) {
    return res.status(400).json({ error: 'Invalid severity' });
  }

  if (actionRequired !== undefined && typeof actionRequired !== 'string') {
    return res.status(400).json({ error: 'Action required must be text' });
  }

  if (updateText !== undefined && typeof updateText !== 'string') {
    return res.status(400).json({ error: 'Progress update must be text' });
  }

  const changes = [];

  if (status !== undefined && status !== event.status) {
    changes.push(`Status: ${event.status} → ${status}`);
    event.status = status;
  }

  if (severity !== undefined && severity !== event.severity) {
    changes.push(`Severity: ${event.severity} → ${severity}`);
    event.severity = severity;
  }

  if (actionRequired !== undefined) {
    const nextAction = actionRequired.trim();
    const previousAction = event.actionRequired || '';

    if (nextAction !== previousAction) {
      changes.push(
        `Action required: ${previousAction || 'Not specified'} → ` +
        `${nextAction || 'Not specified'}`
      );
      event.actionRequired = nextAction;
    }
  }

  const note = (updateText || '').trim();

  if (note) {
    changes.push(`Progress update: ${note}`);
  }

  if (!changes.length) {
    return res.status(400).json({ error: 'No changes or progress update provided.' });
  }

  const timestamp = new Date().toISOString();

  event.updatedAt = timestamp;
  event.updates = event.updates || [];

  event.updates.push({
    author: author || 'Field Coordinator',
    department: department || 'Multi-Agency',
    text: changes.join('\n'),
    timestamp
  });

  io.emit('event_updated', event);
  io.emit('timeline_updated', db.events);

  res.json(event);
});

app.get('/api/sectors', (req, res) => {
  res.json(db.sectors);
});

// Resources CRUD
app.get('/api/resources', (req, res) => {
  res.json(db.resources);
});

app.post('/api/resources', (req, res) => {
  const { name, department, lat, lng, status } = req.body;
  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);

  if (!name || !department || !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return res.status(400).json({ error: 'Missing required fields: name, department, lat, lng' });
  }

  const newResource = {
    id: `res-${Date.now().toString().slice(-4)}`,
    name: name.trim(),
    department: department.trim(),
    lat: parsedLat,
    lng: parsedLng,
    status: (status || 'Active').trim()
  };

  db.resources.push(newResource);
  io.emit('resources_updated', db.resources);
  res.status(201).json(newResource);
});

app.put('/api/resources/:id', (req, res) => {
  const resource = db.resources.find(r => r.id === req.params.id);
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  const { name, department, lat, lng, status } = req.body;

  if (name !== undefined && name.trim()) resource.name = name.trim();
  if (department !== undefined && department.trim()) resource.department = department.trim();
  if (status !== undefined && status.trim()) resource.status = status.trim();

  if (lat !== undefined) {
    const parsedLat = parseFloat(lat);
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      return res.status(400).json({ error: 'Invalid latitude' });
    }
    resource.lat = parsedLat;
  }

  if (lng !== undefined) {
    const parsedLng = parseFloat(lng);
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      return res.status(400).json({ error: 'Invalid longitude' });
    }
    resource.lng = parsedLng;
  }

  io.emit('resources_updated', db.resources);
  res.json(resource);
});

app.delete('/api/resources/:id', (req, res) => {
  const index = db.resources.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  const [removed] = db.resources.splice(index, 1);
  io.emit('resources_updated', db.resources);
  res.json(removed);
});

app.get('/api/weather', (req, res) => {
  res.json(db.weather);
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit('init_state', db);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});