// Global variables
let scene, camera, renderer, controls;
let robot = null;
let joints = {};
let telemetryConnection = null;
let updateInterval = null;
let isConnected = false;

// GitHub URDF and CAD folder URLs - we will use the PyBullet version of the URDF
const URDF_URL = 'https://raw.githubusercontent.com/ggldnl/Hexapod-Hardware/main/hexapod.urdf';
const CAD_BASE_URL = 'https://raw.githubusercontent.com/ggldnl/Hexapod-Hardware/main/CAD/';

// Meshes
let stlLoader = null;
const meshCache = {};


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
    camera.position.set(1, 1, 1);
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
    directionalLight1.shadow.mapSize.width = 20480;
    directionalLight1.shadow.mapSize.height = 20480;
    scene.add(directionalLight1);
    
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight2.position.set(-5, 5, -5);
    scene.add(directionalLight2);
    
    // Grid
    // const gridHelper = new THREE.GridHelper(5, 20, 0xcccccc, 0xe0e0e0);
    // scene.add(gridHelper);
    
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

async function loadMeshCached(filename) {
    if (!meshCache[filename]) {
        meshCache[filename] = loadMeshFromGitHub(filename);
    }
    return meshCache[filename];
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
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const urdfContent = e.target.result;
        parseURDF(urdfContent);
    };
    reader.readAsText(file);
}

async function parseURDF(urdfContent) {

    if (robot) {
        scene.remove(robot);
        robot = null;
        joints = {};
    }

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
        if (xmlDoc.querySelector("parsererror")) {
            throw new Error("XML parsing error");
        }

        robot = new THREE.Group();
        robot.name = "robot";

        // URDF is Z-up, Three.js is Y-up
        robot.rotation.x = -Math.PI / 2;


        // Joint parsing
        const jointData = {};
        const jointElements = xmlDoc.querySelectorAll("joint");

        jointElements.forEach(joint => {
            const name = joint.getAttribute("name");
            const type = joint.getAttribute("type");

            const parent = joint.querySelector("parent")?.getAttribute("link");
            const child = joint.querySelector("child")?.getAttribute("link");

            const origin = joint.querySelector("origin");
            const axis = joint.querySelector("axis");

            jointData[name] = {
                name,
                type,
                parent,
                child,
                xyz: origin?.getAttribute("xyz")?.split(" ").map(Number) || [0,0,0],
                rpy: origin?.getAttribute("rpy")?.split(" ").map(Number) || [0,0,0],
                axis: axis?.getAttribute("xyz")?.split(" ").map(Number) || [0,0,1]
            };

            if (type === "revolute" || type === "continuous") {
                joints[name] = {
                    name,
                    type,
                    angle: 0,
                    axis: jointData[name].axis,
                    object: null
                };
            }
        });

        // Link visuals
        const linkMeshes = {};
        const linkElements = xmlDoc.querySelectorAll("link");

        for (let i = 0; i < linkElements.length; i++) {
            const link = linkElements[i];
            const linkName = link.getAttribute("name");
            const visual = link.querySelector("visual");

            if (!visual) continue;

            const geometry = visual.querySelector("geometry");
            let mesh;

            if (geometry.querySelector("box")) {
                const size = geometry.querySelector("box")
                    .getAttribute("size").split(" ").map(Number);
                mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(size[0], size[1], size[2]),
                    new THREE.MeshPhongMaterial({ color: getLinkColor(i) })
                );
            }

            else if (geometry.querySelector("cylinder")) {
                const c = geometry.querySelector("cylinder");
                mesh = new THREE.Mesh(
                    new THREE.CylinderGeometry(
                        parseFloat(c.getAttribute("radius")),
                        parseFloat(c.getAttribute("radius")),
                        parseFloat(c.getAttribute("length")),
                        16
                    ),
                    new THREE.MeshPhongMaterial({ color: getLinkColor(i) })
                );
                mesh.rotation.x = Math.PI / 2; // URDF cylinders are Z-aligned
            }

            else if (geometry.querySelector("sphere")) {
                mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(
                        parseFloat(geometry.querySelector("sphere").getAttribute("radius")),
                        16, 16
                    ),
                    new THREE.MeshPhongMaterial({ color: getLinkColor(i) })
                );
            }

            else if (geometry.querySelector("mesh")) {
                const meshEl = geometry.querySelector("mesh");
                const filename = meshEl.getAttribute("filename");

                const baseGeom = await loadMeshCached(filename);
                const geom = baseGeom.clone();

                const scale = meshEl.getAttribute("scale");
                if (scale) {
                    const s = scale.split(" ").map(Number);
                    geom.scale(s[0], s[1], s[2]);
                }

                mesh = new THREE.Mesh(
                    geom,
                    new THREE.MeshPhongMaterial({ color: getLinkColor(i) })
                );
            }

            if (!mesh) continue;

            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Visual frame
            const visualGroup = new THREE.Group();
            visualGroup.add(mesh);

            const origin = visual.querySelector("origin");
            if (origin) {
                const xyz = origin.getAttribute("xyz")?.split(" ").map(Number) || [0,0,0];
                const rpy = origin.getAttribute("rpy")?.split(" ").map(Number) || [0,0,0];

                visualGroup.position.set(xyz[0], xyz[1], xyz[2]);

                const qx = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(1,0,0), rpy[0]
                );
                const qy = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0,1,0), rpy[1]
                );
                const qz = new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0,0,1), rpy[2]
                );

                visualGroup.quaternion.multiply(qz).multiply(qy).multiply(qx);
            }

            linkMeshes[linkName] = visualGroup;
        }

        // Link groups
        const linkObjects = {};
        Object.entries(linkMeshes).forEach(([name, visual]) => {
            const linkGroup = new THREE.Group();
            linkGroup.name = `link_${name}`;
            linkGroup.add(visual);
            linkObjects[name] = linkGroup;
        });

        // Kinematic tree
        Object.entries(linkObjects).forEach(([linkName, linkGroup]) => {
            const joint = Object.values(jointData).find(j => j.child === linkName);

            if (!joint) {
                robot.add(linkGroup);
                return;
            }

            const parent = linkObjects[joint.parent];
            if (!parent) return;

            const jointGroup = new THREE.Group();
            jointGroup.name = `joint_${joint.name}`;
            jointGroup.position.set(...joint.xyz);

            const qx = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1,0,0), joint.rpy[0]
            );
            const qy = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0,1,0), joint.rpy[1]
            );
            const qz = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0,0,1), joint.rpy[2]
            );

            jointGroup.quaternion.multiply(qz).multiply(qy).multiply(qx);

            jointGroup.add(linkGroup);
            parent.add(jointGroup);

            if (joints[joint.name]) {
                joints[joint.name].object = jointGroup;
                joints[joint.name].restQuaternion = jointGroup.quaternion.clone();
            }
        });

        scene.add(robot);

        // Set default joint angles
        const defaultJointAngles = {};
        for (let i = 1; i <= 6; i++) {
            defaultJointAngles[`leg_${i}_coxa`] = 0;
            defaultJointAngles[`leg_${i}_femur`] = 45;
            defaultJointAngles[`leg_${i}_tibia`] = -45;
        }
        console.log('Default joint angles:', defaultJointAngles);

        Object.entries(defaultJointAngles).forEach(([jointName, angleDeg]) => {
            const joint = joints[jointName];
            if (!joint || !joint.object) return;

            joint.angle = angleDeg;

            const radians = THREE.MathUtils.degToRad(angleDeg);

            const axis = new THREE.Vector3(
                joint.axis[0],
                joint.axis[1],
                joint.axis[2]
            ).normalize();

            const deltaQ = new THREE.Quaternion()
                .setFromAxisAngle(axis, radians);

            joint.object.quaternion
                .copy(joint.restQuaternion)
                .multiply(deltaQ);
        });
        console.log('Default joint angles applied.');

        // Position robot at origin
        /*
        const box = new THREE.Box3().setFromObject(robot);
        const center = box.getCenter(new THREE.Vector3());
        robot.position.sub(center);
        */

        // Position the robot so its bottom sits on the ground plane y = 0
        const box = new THREE.Box3().setFromObject(robot);
        const center = box.getCenter(new THREE.Vector3());
        robot.position.set(-center.x, -box.min.y, -center.z);

        // Rotate the robot so that it faces the camera
        robot.rotateZ(Math.PI);
        
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
    ];
    
    // return colors[index % colors.length];
    return colors[1];
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
    document.getElementById('connect-btn').textContent = 'Connect';
    
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

function updateTelemetry(data) {

    if (!data.joints || !robot) return;

    Object.entries(data.joints).forEach(([jointName, angleDeg]) => {

        const joint = joints[jointName];
        if (!joint || !joint.object) return;

        joint.angle = angleDeg;

        const radians = THREE.MathUtils.degToRad(angleDeg);

        const axis = new THREE.Vector3(
            joint.axis[0],
            joint.axis[1],
            joint.axis[2]
        ).normalize();

        const deltaQ = new THREE.Quaternion()
            .setFromAxisAngle(axis, radians);

        joint.object.quaternion
            .copy(joint.restQuaternion)
            .multiply(deltaQ);
    });

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
            html += `<div class="telemetry-item">${jointName}: <span class="telemetry-value">${angle.toFixed(1)}</span></div>`;
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
