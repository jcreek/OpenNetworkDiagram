# **Open Network Diagram**

**A declarative, self-hosted tool for visualising and managing home lab & network architecture diagrams.**

---

## **📝 About**

**Open Network Diagram** is an **open-source, self-hosted tool** for creating **interactive network and infrastructure diagrams** using a **declarative JSON format**.

✅ **Fully self-hostable via Docker**  
✅ **Docker-first deployment target** (Netlify optional for demo hosting)
✅ **Interactive network visualisation**  
✅ **Simple file-based configuration**  
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
docker run -d -p 8080:80 -v "$(pwd)/data:/usr/share/nginx/html/data:ro" jcreek23/open-network-diagram
```

- **`-p 8080:80`** → Maps the app to `http://localhost:8080`
- **`-v .../data:/usr/share/nginx/html/data:ro`** → Uses your local `data/network.json`

### **3️⃣ Open the Web UI**

Visit **`http://localhost:8080`** to view your network diagram.

### **4️⃣ Modify Your Network (JSON-Based)**

- Docker runtime reads **`/data/network.json`** from the mounted volume.
- In this repo, your editable file is **`data/network.json`** (gitignored).
- Netlify demo builds use committed sample data at **`static/data/network.json`**.
- After editing JSON, click **Reload Default JSON** in the UI.

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
pnpm run build:netlify  # explicit Netlify target
```

---

## **🛠️ Project Structure**

```text
open-network-diagram/
├── src/                    # Svelte app source
├── static/data/network.json # Demo dataset (Netlify/demo)
├── data/network.json.example # User data template (Docker)
├── Dockerfile              # Docker build/runtime
├── docker-compose.yml      # Local Docker run with mounted data
├── netlify.toml            # Netlify build config
├── .github/workflows/      # CI workflows (Docker image build/push)
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
docker run --rm -p 8080:80 -v "$(pwd)/data:/usr/share/nginx/html/data:ro" open-network-diagram
```

### **CI/CD (GitHub Actions + Netlify)**

- GitHub Actions workflow (`.github/workflows/docker.yml`) builds Docker on PRs.
- Pushes to `main` publish Docker images to **Docker Hub** (`jcreek23/open-network-diagram`).
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

## **🔜 Roadmap**

✅ **Initial version with JSON-based diagrams**  
⏳ **Drag-and-drop editing in the UI**  
⏳ **Custom icons for different devices**  
⏳ **Export diagrams as PNG/SVG/Graphviz**  
⏳ **Dark mode & UI themes**

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
