# LinkedIn Connection Visualizer

## Inspiration

I was recently looking for a job and found a company I really wanted to work for. I looked them up on LinkedIn and noticed that one of their employees was a **2nd-degree connection**—she wasn't connected to me, but she was connected to a friend of mine.

Instead of sending a cold message to a stranger, I reached out to our mutual connection to ask for an introduction. That small step made a huge difference. It made me realize that **LinkedIn data is a goldmine for deepening real-world relationships**, not just collecting numbers.

"Don't be a stranger." We all prefer to work with people we have some basic trust with. I wanted to build a tool that visualizes these hidden bridges, transforming a flat list of names into a map of warm introductions.

## What We Learned

Building this project taught me several valuable lessons:

- **Graph Theory in Practice**: I learned how force-directed graph algorithms work and how to manipulate 3D camera coordinates to create engaging visualizations
- **Prompt Engineering**: Sending a huge list of JSON objects to an LLM often confuses it. I had to optimize prompts to be concise and structured to get accurate "match scores" back from Gemini
- **The Power of Warm Intros**: Building this reaffirmed that technology should serve to strengthen human connections, not replace them
- **Privacy by Design**: Users are more willing to engage with tools when they know their data stays local and private

## How We Built It

We built the project using a modern web stack focused on client-side performance:

1. **Core Visualization**: We used **JavaScript** and **WebGL** (via **Three.js** and **3d-force-graph**) to render the network in 3D space
2. **Data Processing**: We used **D3.js** to parse the raw `Connections.csv` file exported from LinkedIn
3. **AI Integration**: We connected to the **Google Gemini API** (`gemini-3-flash-preview`). The app extracts key profile data (Headline, Company) and sends it to Gemini, which scores connections based on their relevance to the user's query

### The Math Behind the Visualization

To visualize the "freshness" of connections in 3D space, we applied a normalization formula. We wanted newer connections to appear closer to the center (the user) and older connections to drift further out.

We calculated the radial distance \\(d\\) for each node using:

$$
d = d_{base} + (1 - \frac{t - t_{min}}{t_{max} - t_{min}}) \times d_{scale}
$$

Where:
- \\(t\\) is the specific connection date (timestamp)
- \\(t_{min}\\) and \\(t_{max}\\) are the oldest and newest connection dates in the network
- This creates a normalized "freshness" score between 0 and 1, which we invert so that fresh connections have a smaller distance \\(d\\)

## Challenges We Faced

- **Balancing AI with Privacy**: We wanted to use the power of Gemini without compromising user trust. We had to ensure that we only sent the minimum necessary text context to the API and that no data was stored persistently

- **The "Hairball" Effect**: Visualizing hundreds of connections usually results in a messy "hairball" graph. We spent a lot of time tweaking the physics engine (charge strength, link distance) and creating custom sorting modes (Radial vs. Timeline) to make the data actually readable

- **Unstructured Data**: LinkedIn exports are often messy. Dates are in different formats, and people put emojis in their names. Writing a robust parser that didn't crash on edge cases was a significant hurdle

- **Context Window Limits**: Feeding an entire social network into an LLM is token-expensive. We had to heavily optimize our prompt engineering, extracting only the critical metadata (Role, Company, Name) to keep the analysis fast and within the Gemini API's limits

## Key Features

- **Privacy First**: The project processes your data locally. It doesn't save your contacts to any server—everything stays private to you
- **AI Network Navigator**: Ask questions like *"Who works in gaming?"* or *"Find me potential co-founders"* and the AI highlights relevant connections
- **Timeline Analysis**: See how your professional circle has expanded over the years with interactive filtering
- **3D Interactive Visualization**: Fly through your network in a beautiful 3D space instead of scrolling through a spreadsheet

---

## Built With

- **JavaScript** - Core programming language
- **Three.js** - 3D rendering engine
- **3d-force-graph** - Physics-based graph visualization
- **D3.js** - CSV parsing and data manipulation
- **Google Gemini API** - AI-powered network analysis
- **HTML5 / CSS3** - Frontend structure and styling
- **WebGL** - Hardware-accelerated 3D graphics
