# **Open Network Diagram**

![Docker Pulls](https://img.shields.io/docker/pulls/jcreek23/open-network-diagram)
![Release Workflow](https://img.shields.io/github/actions/workflow/status/jcreek/OpenNetworkDiagram/release.yml?branch=main&label=release)
![Docker CI Workflow](https://img.shields.io/github/actions/workflow/status/jcreek/OpenNetworkDiagram/docker.yml?label=docker%20ci)
![Latest Release](https://img.shields.io/github/v/release/jcreek/OpenNetworkDiagram?display_name=tag&sort=semver)
![Netlify](https://img.shields.io/netlify/3128f05f-831b-412c-ada0-46bc3d6e61d5)

**A declarative, self-hosted tool for visualising and managing home lab & network architecture diagrams.**

---

## **📝 About**

**Open Network Diagram** is an **open-source, self-hosted tool** for creating **interactive network and infrastructure diagrams** using a **declarative JSON format**.

✅ **Fully self-hostable via Docker**  
✅ **Docker-first deployment target** (Netlify optional for demo hosting)
✅ **Interactive network visualisation**  
✅ **Single-page modal editor with live updates**  
✅ **Debounced autosave to JSON (self-hosted)**  
✅ **Local vendored icon catalog (offline runtime)**  
✅ **Lightweight Svelte**

Use it to **document your home lab, office network, or cloud infrastructure** with an easy-to-use web interface.

---

## **🚀 Quick Start (For Users)**

### **1️⃣ Create Your Runtime Data File**

Copy the template and edit your own network data:

```bash
cp data/network.json.example data/network.json
```

### **2️⃣ Run Open Network Diagram via Docker**

From this repo:

```bash
docker compose up --build
```

Or pull and run directly:

```bash
docker run -d -p 8080:3000 \
  -e NETWORK_DATA_FILE=/app/data/network.json \
  -e NETWORK_BACKUP_DIR=/app/data/.backups \
  -v "$(pwd)/data:/app/data" \
  jcreek23/open-network-diagram
```

- **`-p 8080:3000`** → Maps the app to `http://localhost:8080`
- **`-v .../data:/app/data`** → Uses your local writable `data/network.json`

### **3️⃣ Open the Web UI**

Visit **`http://localhost:8080`** to view your network diagram.

### **4️⃣ Modify Your Network (Modal UI + JSON Persistence)**

- Edit machines/devices/VMs/ports directly in the modal UI.
- Diagram updates immediately as you edit.
- In self-hosted Docker/local mode, changes autosave to mounted **`data/network.json`**.
- Netlify/demo is intentionally read-only; edits are in-memory only.

---

## **👩‍💻 Development Setup**

### **1️⃣ Clone the Repository**

```bash
git clone https://github.com/jcreek/OpenNetworkDiagram.git
cd open-network-diagram
```

### **2️⃣ Install Dependencies**

```bash
pnpm install
```

### **3️⃣ Run in Development Mode**

```bash
pnpm run dev
```

- Runs at `http://localhost:5173`

### **4️⃣ Build Targets**

```bash
pnpm run build          # default (Docker/static target)
pnpm run build:docker   # explicit Docker/static target
pnpm run build:netlify  # Netlify target (read-only mode)
pnpm run icons:manifest # regenerate local vendor icon manifest
```

---

## **🛠️ Project Structure**

```text
open-network-diagram/
├── src/                    # Svelte app source
├── src/lib/config/vendorIconManifest.ts # Generated local icon catalog
├── static/data/network.json # Demo dataset (Netlify/demo)
├── static/icons/vendor/     # Vendored icon assets (runtime-local)
├── data/network.json.example # User data template (Docker)
├── third_party/             # Third-party license/provenance notes
├── Dockerfile              # Docker build/runtime
├── server.mjs              # Node runtime server (static + /api/network-data)
├── docker-compose.yml      # Local Docker run with mounted data
├── netlify.toml            # Netlify build config
├── .github/workflows/      # CI workflows (PR build + automated release/publish)
└── README.md               # Documentation
```

---

## **📦 Docker Build & Deployment**

### **Build the Docker Image Locally**

```bash
docker build -t open-network-diagram .
```

### **Run Locally**

```bash
docker run --rm -p 8080:3000 \
  -e NETWORK_DATA_FILE=/app/data/network.json \
  -e NETWORK_BACKUP_DIR=/app/data/.backups \
  -v "$(pwd)/data:/app/data" \
  open-network-diagram
```

### **Write API Environment Variables**

- **`NETWORK_READ_ONLY`** (default: `false`)  
  Set to `true` to disable `PUT /api/network-data` and force read-only mode.
- **`NETWORK_DATA_FILE`** (default: `data/network.json`)  
  JSON file path to read/write.
- **`NETWORK_BACKUP_DIR`** (default: sibling `.backups`)  
  Backup directory for rolling save backups (last 5 retained).

### **Local Icon Catalog (No Runtime Network Dependency)**

- Icons are vendored locally under **`static/icons/vendor/homarr/`**.
- The searchable catalog is generated into **`src/lib/config/vendorIconManifest.ts`**.
- Third-party provenance and licensing are documented in:
  - **`third_party/homarr-dashboard-icons/SOURCE.txt`**
  - **`third_party/homarr-dashboard-icons/LICENSE`**
  - **`third_party/homarr-dashboard-icons/NOTICE.txt`**
- Runtime icon search/rendering does not call external APIs.

### **CI/CD (GitHub Actions + Netlify)**

- GitHub Actions workflow (`.github/workflows/docker.yml`) builds Docker on PRs (validation only).
- GitHub Actions workflow (`.github/workflows/release.yml`) runs on `main`, creates semantic version tags/releases, and publishes Docker images to **Docker Hub** (`jcreek23/open-network-diagram`).
- Netlify uses its own CI/CD pipeline with `netlify.toml` (`pnpm run build:netlify`).

---

## **📝 JSON Network Configuration Example**

Define your network using **`network.json`**:

```json
{
	"machines": [
		{
			"machineName": "ProxRouter",
			"ipAddress": "10.0.0.3",
			"role": "Hypervisor",
			"operatingSystem": "Proxmox",
			"software": {
				"vms": [{ "name": "OpnSense", "role": "Router", "ipAddress": "10.0.0.4" }]
			},
			"hardware": {
				"cpu": "Intel N100",
				"ram": "8GB",
				"networkPorts": 4
			}
		}
	],
	"devices": [{ "name": "Switch", "ipAddress": "10.0.0.2", "type": "Nintendo Switch" }]
}
```

---

## **🤝 Contributing**

We welcome contributions! To contribute:

1. **Fork the repository**.
2. **Create a feature branch** (`git checkout -b feature-name`).
3. **Commit your changes** (`git commit -m "Add feature X"`).
4. **Push to your fork** (`git push origin feature-name`).
5. **Submit a Pull Request**.

---

## **📜 License**

[GNU GPL v3 License](LICENSE) – Free to use, modify, and distribute, except distributing closed source versions.

---

## **📬 Contact**

**Author:** [Joshua Creek](https://github.com/jcreek)  
**Project Repo:** [GitHub](https://github.com/jcreek/OpenNetworkDiagram)
