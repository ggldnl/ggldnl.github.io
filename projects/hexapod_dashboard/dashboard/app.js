// Global variables
let scene, camera, renderer, controls;
let robot = null;
let joints = {};
let telemetryConnection = null;
let updateInterval = null;
let isConnected = false;
let isPanelOpen = false;

// GitHub URDF and CAD folder URLs - we will use the PyBullet version of the URDF
const URDF_URL = 'https://raw.githubusercontent.com/ggldnl/Hexapod-Hardware/main/hexapod.urdf';
const CAD_BASE_URL = 'https://raw.githubusercontent.com/ggldnl/Hexapod-Hardware/main/CAD/';

// Meshes
let stlLoader = null;
const meshCache = {};

// Animation system
let animationQueue = [];
let currentAnimation = null;

// Define poses for startup animation
const INITIAL_POSE = {
    leg_1_coxa: 0, leg_1_femur: 0, leg_1_tibia: 0,
    leg_2_coxa: 0, leg_2_femur: 0, leg_2_tibia: 0,
    leg_3_coxa: 0, leg_3_femur: 0, leg_3_tibia: 0,
    leg_4_coxa: 0, leg_4_femur: 0, leg_4_tibia: 0,
    leg_5_coxa: 0, leg_5_femur: 0, leg_5_tibia: 0,
    leg_6_coxa: 0, leg_6_femur: 0, leg_6_tibia: 0,
};

const LEGS_UP = {
    leg_1_coxa: 0, leg_1_femur: 80, leg_1_tibia: 0,
    leg_2_coxa: 0, leg_2_femur: 80, leg_2_tibia: 0,
    leg_3_coxa: 0, leg_3_femur: 80, leg_3_tibia: 0,
    leg_4_coxa: 0, leg_4_femur: 80, leg_4_tibia: 0,
    leg_5_coxa: 0, leg_5_femur: 80, leg_5_tibia: 0,
    leg_6_coxa: 0, leg_6_femur: 80, leg_6_tibia: 0,
};

const LEGS_DOWN = {
    leg_1_coxa: 0, leg_1_femur: 45, leg_1_tibia: -45,
    leg_2_coxa: 0, leg_2_femur: 45, leg_2_tibia: -45,
    leg_3_coxa: 0, leg_3_femur: 45, leg_3_tibia: -45,
    leg_4_coxa: 0, leg_4_femur: 45, leg_4_tibia: -45,
    leg_5_coxa: 0, leg_5_femur: 45, leg_5_tibia: -45,
    leg_6_coxa: 0, leg_6_femur: 45, leg_6_tibia: -45,
};

const STANDING_POSE = {
    leg_1_coxa: 0, leg_1_femur: 25, leg_1_tibia: -60,
    leg_2_coxa: 0, leg_2_femur: 25, leg_2_tibia: -60,
    leg_3_coxa: 0, leg_3_femur: 25, leg_3_tibia: -60,
    leg_4_coxa: 0, leg_4_femur: 25, leg_4_tibia: -60,
    leg_5_coxa: 0, leg_5_femur: 25, leg_5_tibia: -60,
    leg_6_coxa: 0, leg_6_femur: 23, leg_6_tibia: -60,  // TODO Leg 6 has something wrong in URDF
};
const STANDING_HEIGHT_DELTA = 0.029;

// Initialize Three.js scene
function initScene() {
    const container = document.getElementById('canvas-container');
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe8d5e8);
    
    // Camera
    camera = new THREE.PerspectiveCamera(
        20,
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
    
    // Update current animation if one is running
    if (currentAnimation) {
        updateAnimation();
    }
    
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
        await parseURDF(urdfContent);
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

        // Set initial pose
        setJointAngles(INITIAL_POSE);
        console.log('Initial pose applied.');

        // Position the robot so its bottom sits on the ground plane y = 0
        const box = new THREE.Box3().setFromObject(robot);
        const center = box.getCenter(new THREE.Vector3());
        robot.position.set(-center.x, -box.min.y, -center.z);

        // Rotate the robot so that it faces the camera
        robot.rotateZ(Math.PI);
        
        showStatus(`Robot loaded: ${Object.keys(joints).length} joints`, 'success');

        // Generate joint sliders
        generateJointSliders();

        // Start the startup animation sequence
        startStartupAnimations();

    } catch (error) {
        console.error('Error parsing URDF:', error);
        showStatus('Error loading URDF: ' + error.message, 'error');
    }
}

function setJointAngles(angles) {
    Object.entries(angles).forEach(([jointName, angleDeg]) => {
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
}

function animateRobot(initialPose, finalPose, duration = 2000, finalBodyPose = null) {
    return new Promise((resolve) => {
        const animation = {
            startPose: { ...initialPose },
            targetPose: { ...finalPose },
            duration: duration,
            startTime: Date.now(),
            resolve: resolve,
            // Body animation
            startBodyPose: finalBodyPose ? {
                position: { ...robot.position },
                rotation: { 
                    x: robot.rotation.x, 
                    y: robot.rotation.y, 
                    z: robot.rotation.z 
                }
            } : null,
            targetBodyPose: finalBodyPose ? {
                position: { ...finalBodyPose.position },
                rotation: finalBodyPose.rotation ? { ...finalBodyPose.rotation } : null
            } : null
        };
        
        // If no animation is running, start this one immediately
        if (!currentAnimation) {
            currentAnimation = animation;
            setSliderInteraction(false);
            console.log('Animation started');
        } else {
            // Queue the animation
            animationQueue.push(animation);
            console.log('Animation queued');
        }
    });
}

function updateAnimation() {
    if (!currentAnimation) return;
    
    const elapsed = Date.now() - currentAnimation.startTime;
    const progress = Math.min(elapsed / currentAnimation.duration, 1.0);
    
    // Ease-in-out interpolation
    const t = progress < 0.5 
        ? 2 * progress * progress 
        : -1 + (4 - 2 * progress) * progress;
    
    // Interpolate joint angles
    const currentPose = {};
    for (const jointName in currentAnimation.startPose) {
        currentPose[jointName] = currentAnimation.startPose[jointName] + 
            (currentAnimation.targetPose[jointName] - currentAnimation.startPose[jointName]) * t;
    }
    
    setJointAngles(currentPose);
    updateSliderValues(currentPose);
    
    // Interpolate body pose if provided
    if (currentAnimation.targetBodyPose && currentAnimation.startBodyPose) {
        const start = currentAnimation.startBodyPose;
        const target = currentAnimation.targetBodyPose;
        
        // Interpolate position
        robot.position.x = start.position.x + (target.position.x - start.position.x) * t;
        robot.position.y = start.position.y + (target.position.y - start.position.y) * t;
        robot.position.z = start.position.z + (target.position.z - start.position.z) * t;
        
        // Interpolate rotation if specified
        if (target.rotation) {
            robot.rotation.x = start.rotation.x + (target.rotation.x - start.rotation.x) * t;
            robot.rotation.y = start.rotation.y + (target.rotation.y - start.rotation.y) * t;
            robot.rotation.z = start.rotation.z + (target.rotation.z - start.rotation.z) * t;
        }
    }
    
    if (progress >= 1.0) {
        // Animation completed
        currentAnimation.resolve();
        console.log('Animation completed');
        
        // Check if there are more animations in the queue
        if (animationQueue.length > 0) {
            currentAnimation = animationQueue.shift();
            currentAnimation.startTime = Date.now();
            console.log('Starting next animation from queue');
        } else {
            currentAnimation = null;
            setSliderInteraction(true);
            console.log('All animations completed, sliders enabled');
        }
    }
}

function setSliderInteraction(enabled) {
    const sliders = document.querySelectorAll('.joint-slider');
    sliders.forEach(slider => {
        slider.disabled = !enabled;
        if (enabled) {
            slider.style.opacity = '1';
            slider.style.cursor = 'pointer';
        } else {
            slider.style.opacity = '0.5';
            slider.style.cursor = 'not-allowed';
        }
    });
}

async function startStartupAnimations() {
    console.log('Starting startup animation sequence');
    
    // Get current robot position for reference
    const currentPos = {
        x: robot.position.x,
        y: robot.position.y,
        z: robot.position.z
    };
    
    // Stand up from ground (obviously fake)

    await animateRobot(INITIAL_POSE, LEGS_UP, 1500);
    await animateRobot(LEGS_UP, LEGS_DOWN, 1500);
    
    // Fake standing by raising the base
    await animateRobot(
        LEGS_DOWN, 
        STANDING_POSE, 
        1500,
        {
            position: {
                x: currentPos.x,
                y: currentPos.y + STANDING_HEIGHT_DELTA,  // Raise the body by 0.05 units
                z: currentPos.z
            }
        }
    );
    
    console.log('Startup animation sequence complete');
}

function getLinkColor(index) {
    const colors = [
        0x95a5a6, // Gray
        0x7f8c8d, // Dark gray
        0xbdc3c7, // Light gray
    ];
    
    return colors[1];
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

// Panel Toggle
function initPanelToggle() {
    const toggleBtn = document.getElementById('toggle-panel-btn');
    const panel = document.getElementById('left-panel');
    const canvasContainer = document.getElementById('canvas-container');
    const fileUpload = document.querySelector('.file-upload');
    const panelToggleDiv = document.querySelector('.panel-toggle');
    
    toggleBtn.addEventListener('click', () => {
        isPanelOpen = !isPanelOpen;
        
        if (isPanelOpen) {
            panel.classList.add('open');
            canvasContainer.classList.add('panel-open');
            fileUpload.classList.add('panel-open');
            panelToggleDiv.classList.add('panel-open');
            toggleBtn.classList.add('open');
        } else {
            panel.classList.remove('open');
            canvasContainer.classList.remove('panel-open');
            fileUpload.classList.remove('panel-open');
            panelToggleDiv.classList.remove('panel-open');
            toggleBtn.classList.remove('open');
        }
        
        // Trigger window resize to update canvas
        onWindowResize();
    });
}

// Generate Joint Sliders
function generateJointSliders() {
    const container = document.getElementById('joint-sliders');
    container.innerHTML = '';
    
    // Group joints by leg
    for (let legNum = 1; legNum <= 6; legNum++) {
        const legGroup = document.createElement('div');
        legGroup.className = 'joint-group';
        
        const legTitle = document.createElement('div');
        legTitle.className = 'joint-group-title';
        legTitle.textContent = `Leg ${legNum}`;
        legGroup.appendChild(legTitle);
        
        // Create sliders for coxa, femur, tibia
        ['coxa', 'femur', 'tibia'].forEach(jointType => {
            const jointName = `leg_${legNum}_${jointType}`;
            const joint = joints[jointName];
            
            if (!joint) return;
            
            const sliderItem = document.createElement('div');
            sliderItem.className = 'joint-slider-item';
            
            const label = document.createElement('div');
            label.className = 'joint-slider-label';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = jointType.charAt(0).toUpperCase() + jointType.slice(1);
            
            const valueSpan = document.createElement('span');
            valueSpan.className = 'joint-value';
            valueSpan.id = `value-${jointName}`;
            valueSpan.textContent = `${joint.angle.toFixed(1)}°`;
            
            label.appendChild(nameSpan);
            label.appendChild(valueSpan);
            
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'joint-slider';
            slider.id = `slider-${jointName}`;
            slider.min = -90;
            slider.max = 90;
            slider.value = joint.angle;
            slider.step = 0.5;
            
            slider.addEventListener('input', (e) => {
                const angle = parseFloat(e.target.value);
                joint.angle = angle;
                valueSpan.textContent = `${angle.toFixed(1)}°`;
                
                const radians = THREE.MathUtils.degToRad(angle);
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
            
            sliderItem.appendChild(label);
            sliderItem.appendChild(slider);
            legGroup.appendChild(sliderItem);
        });
        
        container.appendChild(legGroup);
    }
}

function updateSliderValues(angles) {
    Object.entries(angles).forEach(([jointName, angle]) => {
        const slider = document.getElementById(`slider-${jointName}`);
        const valueSpan = document.getElementById(`value-${jointName}`);
        
        if (slider && valueSpan) {
            slider.value = angle;
            valueSpan.textContent = `${angle.toFixed(1)}°`;
        }
    });
}

// Initialize scene and load URDF on page load
window.addEventListener('load', function() {
    initScene();
    initPanelToggle();
    loadURDFFromURL(URDF_URL);
});