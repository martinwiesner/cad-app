// src/viewer/CadViewer.tsx
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useViewerStore, type ViewerMesh } from '../state/viewerStore';
import { useSelectionStore } from '../state/selectionStore';
import { useGraphStore } from '../state/graphStore';
import { getProceduralTexture } from './proceduralTextures';
import type { EdgeData } from '../cad/types';

// ===========================================================================
//   ShapeMesh - Solid + Drahtgitter
// ===========================================================================
function ShapeMesh({ mesh }: { mesh: ViewerMesh }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.data.normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.data.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }, [mesh.data]);

  // UV-Koordinaten fuer Texturen aus Bounding-Box ableiten (planares Mapping
  // pro Hauptebene). Reicht fuer Holzplatten und Stahlbleche - bei stark
  // gekruemmten Flaechen sind UVs nicht perfekt, aber visuell ok.
  useEffect(() => {
    if (!mesh.material?.texture) return;
    const bbox = geometry.boundingBox;
    if (!bbox) return;
    const positions = geometry.attributes.position.array as Float32Array;
    const uvs = new Float32Array((positions.length / 3) * 2);
    const scale = mesh.material.textureScale ?? 50;
    // Wir mappen auf die XY-Ebene (Default). Fuer Top-/Bottom-Faces gut, fuer
    // Seitenwaende ggf. gestreckt - das gleicht das Auge meist aus.
    for (let i = 0; i < positions.length / 3; i++) {
      uvs[i * 2] = positions[i * 3] / scale;
      uvs[i * 2 + 1] = positions[i * 3 + 1] / scale;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }, [geometry, mesh.material]);

  // Texturen prozedural erzeugen wenn Material es verlangt
  const texture = useMemo(() => {
    const mat = mesh.material;
    if (!mat?.texture) return null;
    // Variant aus preset ableiten
    let variant: 'oak' | 'walnut' | 'birch' | 'metal' = 'metal';
    if (mat.preset === 'wood-oak') variant = 'oak';
    else if (mat.preset === 'wood-walnut') variant = 'walnut';
    else if (mat.preset === 'wood-birch') variant = 'birch';
    return getProceduralTexture(mat.texture, mat.color, variant);
  }, [mesh.material]);

  // Cleanup
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  const mat = mesh.material;
  const color = mat?.color ?? mesh.color ?? '#cfd6dc';
  const metalness = mat?.metalness ?? 0.1;
  const roughness = mat?.roughness ?? 0.55;
  const opacity = mat?.opacity ?? 1.0;
  const transparent = opacity < 1.0;

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={color}
          metalness={metalness}
          roughness={roughness}
          map={texture ?? null}
          opacity={opacity}
          transparent={transparent}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry, 25]} />
        <lineBasicMaterial color="#1a2030" transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

// ===========================================================================
//   EdgeOverlay - klickbare Kanten im Pick-Modus
// ===========================================================================
function EdgeOverlay({ meshId, edges }: { meshId: string; edges: EdgeData[] }) {
  const pickingNodeId = useSelectionStore((s) => s.pickingNodeId);
  const hoveredEdgeId = useSelectionStore((s) => s.hoveredEdgeId);
  const setHover = useSelectionStore((s) => s.setHover);
  const selectedIds = useGraphStore((s) => {
    if (!pickingNodeId) return new Set<string>();
    const node = s.doc.nodes.find((n) => n.id === pickingNodeId);
    if (!node) return new Set<string>();
    return new Set<string>(Array.isArray(node.params.edgeIds) ? (node.params.edgeIds as string[]) : []);
  });

  const updateParam = useGraphStore((s) => s.updateNodeParam);

  if (!pickingNodeId) return null;

  // Toggle Edge in Auswahl
  const toggleEdge = (edgeId: string) => {
    const node = useGraphStore.getState().doc.nodes.find((n) => n.id === pickingNodeId);
    if (!node) return;
    const current = Array.isArray(node.params.edgeIds) ? (node.params.edgeIds as string[]) : [];
    const next = current.includes(edgeId)
      ? current.filter((id) => id !== edgeId)
      : [...current, edgeId];
    updateParam(pickingNodeId, 'edgeIds', next);
  };

  return (
    <>
      {edges.map((edge) => (
        <PickableEdge
          key={`${meshId}-${edge.edgeId}`}
          edge={edge}
          selected={selectedIds.has(edge.edgeId)}
          hovered={hoveredEdgeId === edge.edgeId}
          onClick={() => toggleEdge(edge.edgeId)}
          onPointerOver={() => setHover(edge.edgeId)}
          onPointerOut={() => setHover(null)}
        />
      ))}
    </>
  );
}

interface PickableEdgeProps {
  edge: EdgeData;
  selected: boolean;
  hovered: boolean;
  onClick: () => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
}

function PickableEdge({ edge, selected, hovered, onClick, onPointerOver, onPointerOut }: PickableEdgeProps) {
  const lineObject = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(edge.positions, 3));
    const color = selected ? 0xff8800 : hovered ? 0x3ba0ff : 0x1e3a8a;
    const opacity = selected ? 1 : hovered ? 1 : 0.55;
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,   // Linien immer ueber dem Mesh sichtbar
      linewidth: selected ? 4 : hovered ? 3 : 1.5,  // WebGL ignoriert das meist, aber schadet nicht
    });
    const line = new THREE.Line(g, mat);
    line.renderOrder = selected ? 3 : hovered ? 2 : 1;
    return { line, geometry: g, material: mat };
  }, [edge.positions, selected, hovered]);

  useEffect(() => () => {
    lineObject.geometry.dispose();
    lineObject.material.dispose();
  }, [lineObject]);

  return (
    <primitive
      object={lineObject.line}
      onClick={(e: any) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e: any) => { e.stopPropagation(); onPointerOver(); }}
      onPointerOut={(e: any) => { e.stopPropagation(); onPointerOut(); }}
    />
  );
}

// ===========================================================================
//   FitViewController — läuft innerhalb des Canvas, reagiert auf Store-Events
// ===========================================================================
function FitViewController({
  controlsRef,
  meshes,
}: {
  controlsRef: React.RefObject<any>;
  meshes: ViewerMesh[];
}) {
  const { camera } = useThree();
  const fitViewRequest = useViewerStore((s) => s.fitViewRequest);

  useEffect(() => {
    if (fitViewRequest === 0 || meshes.length === 0) return;

    // Bounding Box aus rohen Float32Array-Positionen berechnen
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of meshes) {
      const pos = m.data.positions;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    if (!isFinite(minX)) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const diag = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const dist = diag * 1.8;

    // Richtung behalten, Distanz anpassen
    const dx = camera.position.x - cx;
    const dy = camera.position.y - cy;
    const dz = camera.position.z - cz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len, ny = dy / len, nz = dz / len;

    camera.position.set(
      cx + nx * dist,
      cy + Math.max(ny * dist, diag * 0.25),
      cz + nz * dist,
    );

    if (controlsRef.current) {
      controlsRef.current.target.set(cx, cy, cz);
      controlsRef.current.update();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitViewRequest]);

  return null;
}

// ===========================================================================
//   Viewer Hauptkomponente
// ===========================================================================
export function CadViewer({ visibleIds }: { visibleIds?: Set<string> } = {}) {
  const meshesMap = useViewerStore((s) => s.meshes);
  const meshes = useMemo(() => {
    const all = [...meshesMap.values()];
    return visibleIds && visibleIds.size > 0 ? all.filter((m) => visibleIds.has(m.id)) : all;
  }, [meshesMap, visibleIds]);
  const pickingNodeId = useSelectionStore((s) => s.pickingNodeId);
  const stopPicking = useSelectionStore((s) => s.stopPicking);
  const controlsRef = useRef<any>(null);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        shadows
        camera={{ position: [120, 100, 140], fov: 45, near: 0.001, far: 1e8 }}
        gl={{ logarithmicDepthBuffer: true }}
        style={{ background: 'linear-gradient(180deg, #f3f5f8 0%, #dde3eb 100%)' }}
        raycaster={{
          params: { Line: { threshold: 1.5 } } as any,
        }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight
          position={[120, 180, 80]}
          intensity={0.9}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <directionalLight position={[-80, 60, -80]} intensity={0.25} />

        <Grid
          args={[600, 600]}
          cellSize={10}
          sectionSize={50}
          cellColor="#a8b0bb"
          sectionColor="#5a6470"
          fadeDistance={500}
          fadeStrength={1.2}
          infiniteGrid
          position={[0, -0.01, 0]}
        />

        {meshes.map((m) => (
          <group key={m.id}>
            <ShapeMesh mesh={m} />
            {m.edges && <EdgeOverlay meshId={m.id} edges={m.edges} />}
          </group>
        ))}

        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.12} />
        <FitViewController controlsRef={controlsRef} meshes={meshes} />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#d24', '#2c5', '#28e']} labelColor="#222" />
        </GizmoHelper>
      </Canvas>

      {pickingNodeId && (
        <div className="pick-banner">
          <span>🎯 Kanten-Auswahl aktiv</span>
          <span className="pick-banner__hint">Klick = Kante togglen · Esc = Beenden</span>
          <button className="btn btn--ghost" onClick={stopPicking}>fertig</button>
        </div>
      )}
    </div>
  );
}
