Mapsense AI – Frontend

An AI-powered geospatial dashboard that enables users to interact with maps using natural language. The application combines a conversational AI interface with an interactive GIS workspace, allowing users to perform geospatial analysis, visualize results on a map, and explore spatial data through an intuitive, ChatGPT-inspired user experience.

⸻

Overview

The frontend is built with Next.js (App Router) and follows a modern, scalable architecture optimized for AI-assisted geospatial workflows. Users can ask questions in natural language, receive streamed AI responses, and visualize analysis results directly on the interactive map.

During the initial development phase, the application integrates with an external Mapbox MCP server. Once the project’s dedicated MCP backend is available, it can replace the external MCP without significant frontend changes.

⸻

Features

* AI-powered conversational interface
* ChatGPT-inspired minimal UI
* Interactive GIS map workspace
* Real-time streaming AI responses
* MCP command execution
* Dynamic map visualization
* Layer management
* GeoJSON rendering
* Buffer, polygon, and marker visualization
* Large dataset support
* High-performance rendering
* Responsive dashboard
* Enterprise-grade architecture

⸻

Tech Stack

Framework

* Next.js 16 (App Router)
* React 19
* TypeScript

UI

* Tailwind CSS
* Shadcn UI
* Base UI
* Framer Motion
* Lucide React
* Sonner

State Management

* Zustand

Mapping & GIS

* OpenLayers
* Deck.gl
* Turf.js
* Supercluster

AI & Streaming

* MCP Integration
* Server-Sent Events (SSE)

⸻

Project Structure

app/
components/
chat/
map/
layout/
shared/
stores/
hooks/
services/
workers/
utils/
types/
constants/
lib/
providers/
styles/
public/

Each directory follows a single-responsibility architecture to ensure scalability, maintainability, and code organization.

⸻

Core Workflow

1. User submits a natural language query.
2. The frontend sends the request to the MCP server.
3. AI responses stream progressively using Server-Sent Events (SSE).
4. Structured MCP commands are validated.
5. Commands update the application state.
6. The map renders the resulting layers, markers, or geometries.
7. The AI provides a textual explanation alongside the visualization.

⸻

Planned GIS Use Cases

* Buffer Search
* Nearby Amenity Search
* Business Location Analysis
* Location Comparison
* Site Suitability Analysis
* Property Price Estimation
* Dynamic Layer Visualization

⸻

Performance Goals

The application is designed to efficiently handle very large geospatial datasets while maintaining a responsive user experience.

Key optimization strategies include:

* State isolation using Zustand
* Incremental layer updates
* Viewport-based rendering
* Web Workers for heavy processing
* Memory and IndexedDB caching
* Dynamic imports
* Lazy loading
* Feature clustering
* React memoization

⸻

Development Roadmap

* Project Setup
* Dashboard UI
* Chat Interface
* Map Integration
* MCP Integration
* Streaming Architecture
* State Management
* Caching
* Performance Optimization
* Error Handling
* Accessibility
* Production Optimization
* Final UI Polish

⸻

Installation

Install project dependencies:

npm install

Start the development server:

npm run dev

Open your browser:

http://localhost:3000

⸻

Future Enhancements

* Custom MCP Backend Integration
* Conversation Persistence
* Multi-session Support
* Advanced GIS Analysis
* Heatmaps
* Hexagonal Aggregation
* 3D Visualization
* Offline Support
* Workspace Sharing
* Export & Import
* AI-generated Reports

⸻

License

This project is intended for internal development and research purposes.