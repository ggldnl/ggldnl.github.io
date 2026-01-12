// Global variables
let scene, camera, renderer, controls;
let robot = null;
let joints = {};
let telemetryConnection = null;
let updateInterval = null;
let isConnected = false;

// GitHub URDF and CAD folder URLs
const URDF_URL = 'https://raw.githubusercontent.com/ggldnl/Hexapod-Hardware/main/hexapod.urdf';
const CAD_BASE_URL = 'https://raw.githubusercontent.com/ggldnl/Hexapod-Hardware/main/CAD/';

// STL Loader
let stlLoader = null;

// Initialize Three.js scene
function initScene() {
    const container = document.getElementById('canvas-container');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8d5e8);
    
    // Camera
    camera = new THREE.PerspectiveCamera(
        50,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
    );
    camera.position.set(2, 2, 2);
    camera.lookAt(0, 0, 0);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    
    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);

    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Enable pan + rotate
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = false;

    // Mouse bindings
    controls.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.PAN,    // click + drag wheel = pan
        RIGHT: THREE.MOUSE.ROTATE  // click + drag right = orbit
    };

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(5, 10, 5);
    directionalLight1.castShadow = true;
    directionalLight1.shadow.mapSize.width = 2048;
    directionalLight1.shadow.mapSize.height = 2048;
    scene.add(directionalLight1);
    
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight2.position.set(-5, 5, -5);
    scene.add(directionalLight2);
    
    // Grid
    const gridHelper = new THREE.GridHelper(5, 20, 0xcccccc, 0xe0e0e0);
    scene.add(gridHelper);
    
    // Ground plane (shadow receiver)
    const groundGeometry = new THREE.PlaneGeometry(10, 10);
    const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize);
    
    // Initialize STL loader
    stlLoader = new THREE.STLLoader();
    
    // Start animation loop
    animate();
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// URDF Loading
async function loadMeshFromGitHub(meshPath) {
    // Extract filename from path (e.g., "package://hexapod/meshes/file.stl" -> "file.stl")
    const filename = meshPath.split('/').pop();
    const meshUrl = CAD_BASE_URL + filename;
    
    console.log(`Loading mesh: ${filename} from ${meshUrl}`);
    showStatus('Loading mesh: ' + filename, 'loading');
    
    return new Promise((resolve, reject) => {
        stlLoader.load(
            meshUrl,
            function(geometry) {
                console.log(`Successfully loaded mesh: ${filename}`);
                resolve(geometry);
            },
            function(xhr) {
                const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
                console.log(`Loading ${filename}: ${percent}%`);
            },
            function(error) {
                console.error(`Error loading mesh ${filename}:`, error);
                reject(error);
            }
        );
    });
}

async function loadURDFFromURL(url) {
    showStatus('Loading robot model...', 'loading');
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const urdfContent = await response.text();
        parseURDF(urdfContent);
    } catch (error) {
        console.error('Error loading URDF from URL:', error);
        showStatus('Error loading robot model: ' + error.message, 'error');
    }
}

function loadURDF(file) {
    showStatus('Loading URDF file...', 'loading');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const urdfContent = e.target.result;
        parseURDF(urdfContent);
    };
    reader.readAsText(file);
}

async function parseURDF(urdfContent) {
    // Clear existing robot
    if (robot) {
        scene.remove(robot);
        robot = null;
        joints = {};
    }
    
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
        
        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            throw new Error('XML parsing error');
        }
        
        console.log('URDF parsed successfully');
        
        // Create robot group
        robot = new THREE.Group();
        robot.name = 'robot';
        
        // Parse joints first
        const jointElements = xmlDoc.querySelectorAll('joint');
        console.log(`Found ${jointElements.length} joints`);
        
        const jointData = {};
        jointElements.forEach(joint => {
            const jointName = joint.getAttribute('name');
            const jointType = joint.getAttribute('type');
            const parent = joint.querySelector('parent')?.getAttribute('link');
            const child = joint.querySelector('child')?.getAttribute('link');
            const origin = joint.querySelector('origin');
            const axis = joint.querySelector('axis');
            
            jointData[jointName] = {
                name: jointName,
                type: jointType,
                parent: parent,
                child: child,
                xyz: origin?.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 0],
                rpy: origin?.getAttribute('rpy')?.split(' ').map(Number) || [0, 0, 0],
                axis: axis?.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 1]
            };
            
            if (jointType === 'revolute' || jointType === 'continuous') {
                joints[jointName] = {
                    name: jointName,
                    angle: 0,
                    type: jointType,
                    axis: axis?.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 1],
                    object: null
                };
            }
        });
        
        console.log('Joint data:', jointData);
        console.log(`Tracking ${Object.keys(joints).length} revolute/continuous joints`);
        
        // Parse links
        const linkElements = xmlDoc.querySelectorAll('link');
        console.log(`Found ${linkElements.length} links`);
        
        const linkMeshes = {};
        
        // Process links sequentially to handle async mesh loading
        for (let i = 0; i < linkElements.length; i++) {
            const link = linkElements[i];
            const linkName = link.getAttribute('name');
            const visual = link.querySelector('visual');
            
            if (!visual) {
                console.log(`Link ${linkName} has no visual element, skipping`);
                continue;
            }
            
            const geometry = visual.querySelector('geometry');
            let mesh;
            
            if (geometry) {
                const box = geometry.querySelector('box');
                const cylinder = geometry.querySelector('cylinder');
                const sphere = geometry.querySelector('sphere');
                const meshElement = geometry.querySelector('mesh');
                
                if (box) {
                    const size = box.getAttribute('size').split(' ').map(Number);
                    const geom = new THREE.BoxGeometry(size[0], size[1], size[2]);
                    const material = new THREE.MeshPhongMaterial({
                        color: getLinkColor(i),
                        shininess: 30
                    });
                    mesh = new THREE.Mesh(geom, material);
                } else if (cylinder) {
                    const radius = parseFloat(cylinder.getAttribute('radius'));
                    const length = parseFloat(cylinder.getAttribute('length'));
                    const geom = new THREE.CylinderGeometry(radius, radius, length, 16);
                    const material = new THREE.MeshPhongMaterial({
                        color: getLinkColor(i),
                        shininess: 30
                    });
                    mesh = new THREE.Mesh(geom, material);
                    // Cylinders in URDF are along Z, Three.js cylinders are along Y
                    mesh.rotation.x = Math.PI / 2;
                } else if (sphere) {
                    const radius = parseFloat(sphere.getAttribute('radius'));
                    const geom = new THREE.SphereGeometry(radius, 16, 16);
                    const material = new THREE.MeshPhongMaterial({
                        color: getLinkColor(i),
                        shininess: 30
                    });
                    mesh = new THREE.Mesh(geom, material);
                } else if (meshElement) {
                    // Load STL mesh from GitHub
                    const meshFilename = meshElement.getAttribute('filename');
                    console.log(`Link ${linkName} uses mesh file: ${meshFilename}`);
                    
                    try {
                        const stlGeometry = await loadMeshFromGitHub(meshFilename);
                        
                        // Apply scale if specified
                        const scale = meshElement.getAttribute('scale');
                        if (scale) {
                            const scaleValues = scale.split(' ').map(Number);
                            stlGeometry.scale(scaleValues[0], scaleValues[1], scaleValues[2]);
                        }
                        
                        // Center the geometry
                        stlGeometry.computeBoundingBox();
                        const center = new THREE.Vector3();
                        stlGeometry.boundingBox.getCenter(center);
                        stlGeometry.translate(-center.x, -center.y, -center.z);
                        
                        const material = new THREE.MeshPhongMaterial({
                            color: getLinkColor(i),
                            shininess: 30,
                            flatShading: false
                        });
                        
                        mesh = new THREE.Mesh(stlGeometry, material);
                        console.log(`Successfully created mesh for ${linkName}`);
                    } catch (error) {
                        console.error(`Failed to load mesh for ${linkName}, using placeholder`);
                        // Fallback to a simple box
                        const geom = new THREE.BoxGeometry(0.05, 0.05, 0.1);
                        const material = new THREE.MeshPhongMaterial({
                            color: 0xff0000,
                            shininess: 30,
                            opacity: 0.5,
                            transparent: true
                        });
                        mesh = new THREE.Mesh(geom, material);
                    }
                } else {
                    // Fallback: create small sphere
                    const geom = new THREE.SphereGeometry(0.02, 8, 8);
                    const material = new THREE.MeshPhongMaterial({
                        color: 0xff0000,
                        shininess: 30
                    });
                    mesh = new THREE.Mesh(geom, material);
                }
            } else {
                // No geometry, create marker
                const geom = new THREE.SphereGeometry(0.015, 8, 8);
                const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
                mesh = new THREE.Mesh(geom, material);
            }
            
            if (mesh) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.name = linkName;
                
                // Apply visual origin if it exists
                const visualOrigin = visual.querySelector('origin');
                if (visualOrigin) {
                    const xyz = visualOrigin.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 0];
                    const rpy = visualOrigin.getAttribute('rpy')?.split(' ').map(Number) || [0, 0, 0];
                    mesh.position.set(xyz[0], xyz[1], xyz[2]);
                    mesh.rotation.set(rpy[0], rpy[1], rpy[2]);
                }
                
                linkMeshes[linkName] = mesh;
                console.log(`Created mesh for link: ${linkName}`);
            }
        }
        
        // Build kinematic tree
        Object.keys(linkMeshes).forEach(linkName => {
            const mesh = linkMeshes[linkName];
            
            // Find if this link is a child in any joint
            const parentJoint = Object.values(jointData).find(j => j.child === linkName);
            
            if (!parentJoint) {
                // This is the root link
                robot.add(mesh);
                console.log(`Added root link: ${linkName}`);
            } else {
                // This link has a parent, position it relative to parent
                const parentMesh = linkMeshes[parentJoint.parent];
                if (parentMesh) {
                    // Create a group for the joint transformation
                    const jointGroup = new THREE.Group();
                    jointGroup.name = `joint_${parentJoint.name}`;
                    jointGroup.position.set(...parentJoint.xyz);
                    jointGroup.rotation.set(...parentJoint.rpy);
                    
                    jointGroup.add(mesh);
                    parentMesh.add(jointGroup);
                    
                    // Store reference for joint updates
                    if (joints[parentJoint.name]) {
                        joints[parentJoint.name].object = jointGroup;
                    }
                    
                    console.log(`Attached ${linkName} to ${parentJoint.parent} via joint ${parentJoint.name}`);
                }
            }
        });
        
        scene.add(robot);
        
        // Center and scale the robot for better viewing
        const box = new THREE.Box3().setFromObject(robot);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        console.log('Robot bounds:', { center, size });
        
        // Position robot at origin
        robot.position.set(-center.x, -box.min.y + 0.01, -center.z);
        
        // Auto-scale if too large or too small
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 2) {
            const scale = 1.5 / maxDim;
            robot.scale.set(scale, scale, scale);
            console.log(`Scaled robot by ${scale}`);
        }
        
        showStatus(`Robot loaded: ${Object.keys(joints).length} joints`, 'success');
        
    } catch (error) {
        console.error('Error parsing URDF:', error);
        showStatus('Error loading URDF: ' + error.message, 'error');
    }
}

function getLinkColor(index) {
    const colors = [
        0x95a5a6, // Gray
        0x7f8c8d, // Dark gray
        0xbdc3c7, // Light gray
        0x95a5a6,
        0x7f8c8d,
        0xbdc3c7
    ];
    return colors[index % colors.length];
}

// Connection handling
function openConnectionModal() {
    document.getElementById('connection-modal').classList.add('active');
}

function closeConnectionModal() {
    document.getElementById('connection-modal').classList.remove('active');
}

function connectToRobot() {
    const address = document.getElementById('robot-ip').value;
    const port = document.getElementById('robot-port').value;
    const updateRate = parseInt(document.getElementById('update-rate').value);
    
    if (!address || !port) {
        alert('Please enter IP address and port');
        return;
    }
    
    closeConnectionModal();
    
    const wsUrl = `ws://${address}:${port}`;
    
    try {
        telemetryConnection = new WebSocket(wsUrl);
        
        telemetryConnection.onopen = function() {
            isConnected = true;
            document.getElementById('connect-btn').classList.add('connected');
            document.getElementById('connect-btn').textContent = 'Connected';
            
            // Start requesting data
            updateInterval = setInterval(() => {
                if (telemetryConnection && telemetryConnection.readyState === WebSocket.OPEN) {
                    telemetryConnection.send(JSON.stringify({ command: 'get_telemetry' }));
                }
            }, 1000 / updateRate);
        };
        
        telemetryConnection.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                updateTelemetry(data);
            } catch (error) {
                console.error('Error parsing telemetry:', error);
            }
        };
        
        telemetryConnection.onerror = function(error) {
            console.error('WebSocket error:', error);
            showStatus('WebSocket error:', error)
        };
        
        telemetryConnection.onclose = function() {
            disconnect();
        };
        
    } catch (error) {
        console.error('Connection error:', error);
        showStatus('Connection error:', error)
    }
}

function disconnect() {
    isConnected = false;
    document.getElementById('connect-btn').classList.remove('connected');
    document.getElementById('connect-btn').textContent = 'Connect Robot';
    
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    if (telemetryConnection) {
        telemetryConnection.close();
        telemetryConnection = null;
    }
    
    // Clear telemetry display
    document.getElementById('telemetry-data').innerHTML = 
        '<div class="no-data">No data. Connect robot to view telemetry.</div>';
}

function startDemoMode(updateRate) {
    isConnected = true;
    document.getElementById('connect-btn').classList.add('connected');
    document.getElementById('connect-btn').textContent = 'Connected (Demo)';
    
    let time = 0;
    updateInterval = setInterval(() => {
        time += 0.1;
        
        // Simulate telemetry data
        const demoData = {
            voltage: 12.0 + Math.sin(time) * 0.5,
            current: 2.5 + Math.sin(time * 1.5) * 0.3,
            joints: {}
        };
        
        // Generate joint angles
        Object.keys(joints).forEach((jointName, index) => {
            const phase = (index * Math.PI * 2) / Object.keys(joints).length;
            demoData.joints[jointName] = Math.sin(time + phase) * 45;
        });
        
        updateTelemetry(demoData);
    }, 1000 / updateRate);
}

function updateTelemetry(data) {
    // Update joint angles in 3D model
    if (data.joints && robot) {
        Object.keys(data.joints).forEach(jointName => {
            if (joints[jointName] && joints[jointName].object) {
                const angle = data.joints[jointName];
                joints[jointName].angle = angle;
                
                // Apply rotation based on joint axis
                const axis = joints[jointName].axis;
                const radians = THREE.MathUtils.degToRad(angle);
                
                // Determine which axis to rotate around
                if (Math.abs(axis[0]) > 0.9) {
                    // X axis
                    joints[jointName].object.rotation.x = radians;
                } else if (Math.abs(axis[1]) > 0.9) {
                    // Y axis
                    joints[jointName].object.rotation.y = radians;
                } else {
                    // Z axis (default)
                    joints[jointName].object.rotation.z = radians;
                }
            }
        });
    }
    
    // Update telemetry display
    updateTelemetryDisplay(data);
}

function updateTelemetryDisplay(data) {
    const container = document.getElementById('telemetry-data');
    let html = '';
    
    // Power data
    if (data.voltage !== undefined) {
        html += `<div class="telemetry-item">Voltage: <span class="telemetry-value">${data.voltage.toFixed(2)} V</span></div>`;
    }
    
    if (data.current !== undefined) {
        html += `<div class="telemetry-item">Current: <span class="telemetry-value">${data.current.toFixed(2)} A</span></div>`;
    }
    
    // Joint angles
    if (data.joints && Object.keys(data.joints).length > 0) {
        // Add a small gap if we have power data
        if (html !== '') {
            html += '<div style="margin-top: 12px;"></div>';
        }
        
        Object.keys(data.joints).sort().forEach(jointName => {
            const angle = data.joints[jointName];
            html += `<div class="telemetry-item">${jointName}: <span class="telemetry-value">${angle.toFixed(1)}°</span></div>`;
        });
    }
    
    // If no data available
    if (html === '') {
        html = '<div class="no-data">No data</div>';
    }
    
    container.innerHTML = html;
}

function showStatus(message, type = '') {
    const statusDiv = document.getElementById('upload-status');
    statusDiv.className = 'status-message ' + type;
    statusDiv.textContent = message;
    
    // Auto-hide success/error messages after 3 seconds
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = '';
        }, 3000);
    }
}

// Event listeners
document.getElementById('connect-btn').addEventListener('click', function() {
    if (isConnected) {
        disconnect();
    } else {
        openConnectionModal();
    }
});

document.getElementById('cancel-btn').addEventListener('click', closeConnectionModal);
document.getElementById('confirm-connect-btn').addEventListener('click', connectToRobot);

// Close modal on outside click
document.getElementById('connection-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeConnectionModal();
    }
});

// Initialize scene and load URDF on page load
window.addEventListener('load', function() {
    initScene();
    loadURDFFromURL(URDF_URL);
});
