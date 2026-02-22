# **Open Network Diagram**

**A declarative, self-hosted tool for visualising and managing home lab & network architecture diagrams.**

---

## **📝 About**

**Open Network Diagram** is an **open-source, self-hosted tool** for creating **interactive network and infrastructure diagrams** using a **declarative JSON format**.

✅ **Fully self-hostable via Docker**  
✅ **JSON-based network structure** (editable in UI or manually)
✅ **Interactive network visualisation**  
✅ **Simple file-based configuration**  
✅ **Lightweight Svelte**

Use it to **document your home lab, office network, or cloud infrastructure** with an easy-to-use web interface.

---

## **🚀 Quick Start (For Users)**

### **1️⃣ Run Open Network Diagram via Docker**

Pull and run the latest image:

```bash
docker run -d -p 8080:3000 jcreek23/open-network-diagram
```

- **`-p 8080:3000`** → Maps the app to `http://localhost:8080`

### **2️⃣ Open the Web UI**

Visit **`http://localhost:8080`** to view your network diagram.

### **3️⃣ Modify Your Network (JSON-Based)**

- The app reads **`/data/network.json`** from static assets.
- In this repo, the default file is **`static/data/network.json`**.
- Update that file to change the diagram data.

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

---

## **🛠️ Project Structure**

```
open-network-diagram/
│   ├── src/              # Svelte components
│   ├── package.json      # Dependencies
│── Dockerfile            # Docker setup
│── .github/workflows/    # CI/CD pipelines
│── README.md             # Documentation
```

---

## **📦 Docker Build & Deployment**

### **Build the Docker Image Locally**

```bash
docker build -t open-network-diagram .
```

### **Run Locally**

```bash
docker run -p 8080:3000 open-network-diagram
```

### **CI/CD (GitHub Actions)**

- Automatic Docker builds when changes are pushed to `main`.
- Pushes the latest image to **Docker Hub**.

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
				"vms": [
					{ "name": "OpnSense", "role": "Router", "ipAddress": "10.0.0.4" },
					{ "name": "PiVPN", "role": "VPN Server", "ipAddress": "10.0.0.5" }
				]
			},
			"hardware": {
				"cpu": "Intel N100",
				"ram": "8GB",
				"networkPorts": 4
			}
		}
	]
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

---

### **🔥 Next Steps**

✅ **Set up GitHub Repo**  
✅ **Push initial project structure**  
✅ **Add CI/CD for automated Docker builds**
