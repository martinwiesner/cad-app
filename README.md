# CAD Konfigurator — Sprint 9

**Volle parametrische Graph-Modellierung im Browser.** OpenCascade.js + React Flow + Three.js.

## Was funktioniert jetzt

- **Voller Graph-Editor** — Nodes per Drag-and-Drop aus Palette, Verbindungen ziehen, Properties rechts editieren.
- **Live-Rebuild** — Slider verschieben → Graph debounced neu rechnen (150 ms) → Viewer aktualisiert.
- **Inkrementelles Caching** — Hash-basiert pro Node. Slider an einem Box-Knoten lässt downstream-fertige Operationen am Cache.
- **Alle MVP-Operationen** — Box, Cylinder, Union, Difference, Intersection, Fillet (alle Kanten), Chamfer (alle Kanten), Hole (parametrisch durchschlagend).
- **STEP-Import** — Datei in den `STEP Import`-Node ziehen, ans Graph-Netz hängen wie eine native Geometrie.
- **Projekt speichern/laden** — Graph als JSON exportieren/importieren.
- **Diagnostics** — Validierung (Zyklen, Typkonflikte) plus Runtime-Fehler pro Node, klickbar zum Springen.
- **Drei eingebaute Beispiele** — Box, Union, Platte mit Bohrung + Fase.

## Setup

```bash
npm install
npm run dev
```

Beim ersten Start lädt OpenCascade.js ~30 MB WASM (einmalig gecacht).

## Erster Eindruck

1. Auf http://localhost:5173 warten, bis `Kernel: ready` grün leuchtet.
2. Toolbar oben: **Platte mit Bohrung + Fase** klicken.
3. Im Editor erscheinen Slider, Box, Hole, Chamfer, Preview — verbunden.
4. Unten: 3D-Viewer mit gefräster Platte.
5. **Slider verschieben** — der Viewer aktualisiert in Echtzeit.
6. Einen Node anklicken → rechte Sidebar zeigt Properties.

## Architektur

```
Main-Thread                                  Worker
─────────────────────                        ───────────────────────
App.tsx                                      kernel.worker.ts
  │                                           │
  ├─ Toolbar (Examples, Save/Load)            └─ OpenCascadeKernel
  ├─ NodePalette (Drag-Source)                    ├── createBox
  ├─ GraphEditor (React Flow)                     ├── createCylinder
  ├─ PropertiesPanel                              ├── booleanDifference
  ├─ DiagnosticsPanel                             ├── booleanUnion
  └─ CadViewer (r3f)                              ├── booleanIntersection
                                                  ├── filletAll
graphStore  ─── debounce 150ms ───►             ├── chamferAll
  executeGraph()                                  ├── hole
  ├─ validateGraph (typ + zyklus)                 ├── importStep
  ├─ topologicalSort                              └── triangulate
  ├─ hashNode (djb2)
  ├─ runNode (RPC pro Op)
  └─ cache (releaseShape bei Invalid)
```

**Kerninvarianten:**
- `TopoDS_Shape` verlässt nie den Worker.
- Main hat nur `ShapeHandle` Strings.
- Pro Hash → ein Shape in der Cache-Registry.
- Wird der Hash invalid, wird das Shape im Worker per `.delete()` freigegeben.

## Dateistruktur (Sprint 2)

```
src/
├── App.tsx, main.tsx, styles.css
│
├── cad/                          CAD-Kernel
│   ├── types.ts
│   ├── CadKernelService.ts       Comlink-Wrapper (Main)
│   ├── kernel.worker.ts          Worker-Entry
│   ├── OpenCascadeKernel.ts      Worker-Implementation
│   ├── shapeRegistry.ts          Handle → TopoDS_Shape
│   ├── memoryScope.ts            RAII fuer WASM-Objekte
│   ├── meshConversion.ts         Triangulation
│   ├── stepImport.ts             STEPControl_Reader
│   └── operations/               Eine Datei pro CAD-Op (API-Wrapper)
│       ├── createBox.ts
│       ├── createCylinder.ts
│       ├── booleanDifference.ts
│       ├── booleanUnion.ts
│       ├── booleanIntersection.ts
│       ├── fillet.ts
│       └── chamfer.ts
│
├── graph/                        Graph-Engine (rein, deterministisch)
│   ├── graphTypes.ts
│   ├── nodeRegistry.ts           NodeSpec-Tabelle (Single Source of Truth)
│   ├── graphValidation.ts        Validierung + Topo-Sort
│   ├── graphExecution.ts         Executor mit Cache
│   ├── hashing.ts                djb2 fuer Cache-Keys
│   └── examples.ts               3 Beispielgraphen
│
├── state/                        Zustand-Stores
│   ├── graphStore.ts             Graph + Aktionen (mit Debounce)
│   ├── statusStore.ts            Kernel/Compute/Validation/Logs
│   ├── viewerStore.ts            Aktive Meshes
│   └── assetStore.ts             STEP-Bytes (in-memory)
│
├── editor/                       Graph-Editor-UI
│   ├── GraphEditor.tsx           React Flow + Custom Nodes
│   ├── NodePalette.tsx           Linke Sidebar
│   └── PropertiesPanel.tsx       Rechte Sidebar
│
├── viewer/CadViewer.tsx          r3f mit Grid, Gizmo, OrbitControls
│
└── components/
    ├── Toolbar.tsx
    └── DiagnosticsPanel.tsx
```

## Stolpersteine

### WASM lädt nicht
- Network-Tab prüfen — `opencascade.full.wasm` muss 200 OK liefern.
- `rm -rf node_modules/.vite && npm run dev` löst die meisten Cache-Probleme.

### Fillet `IsDone() = false`
- Radius zu groß für die Geometrie. Bei einer 50×50×20-Box ist Maximum ~7 mm.
- Diagnostik zeigt `fillet_too_large` — Radius reduzieren.

### `BRep_Tool.Triangulation`-Signatur passt nicht
- `meshConversion.ts` versucht erst 3-arg, dann 2-arg-Form.
- Wenn beide scheitern: Browser-DevTools → Console → in der App **API inspizieren** (kommt zurück in Sprint 3).

### Slider tut nichts
- `Kernel: ready` muss grün sein.
- DevTools Console öffnen, nach `[graphStore]` oder `[Comlink]` filtern.

## Sprint 9 — neu in diesem Sprint

- **Undo/Redo** — Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; bis zu 50 Schritte in der History
- **Mirror-Node** (Transform-Kategorie) — Spiegeln an XY / XZ / YZ-Ebene, verschiebbarer Ebenen-Ursprung, optionales `keepOriginal` (Union Original + Spiegel)
- **Linear-Array-Node** (Transform-Kategorie) — N Kopien mit konstantem Versatz (ΔX/ΔY/ΔZ), alle zu einem Solid vereinigt
- **Ctrl+A** — alle Nodes im Editor auswählen
- **Bugfixes**: Sphere/Cone ctor-Suffix-Erkennung (OCCT _9 für gp_Ax2), IsDone()-C++-Exception-Handling in allen Primitiven + Boolean-Ops, Toolbar „Leer"-Button fix (clear() statt clearAll())

## Was in Sprint 10 kommen könnte

- 2D-Skizzen-Editor für Polygon-Extrusion (visuell statt JSON-String)
- Loft / Sweep zwischen zwei Profilen
- Shell-Node (Hohlkörper / Wandstärke)
- Kreismuster (Circular Array)
- Undo-Indikator in der Toolbar (Ctrl+Z ausgegraut wenn keine History)

## Lizenz

Code: MIT (Vorschlag). OpenCascade.js: LGPL-2.1.
