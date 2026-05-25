// src/cad/materials.ts
// Material-Definitionen. Reine Render-Eigenschaften - keine CAD-Semantik.
//
// Wir nutzen ein PBR-light-Modell (MeshStandardMaterial in Three.js):
//   - baseColor:  hexadezimale Grundfarbe
//   - metalness:  0 = nicht-metallisch, 1 = voll metallisch
//   - roughness:  0 = spiegelnd, 1 = matt
//   - texture:    optional, prozedurale Texturen (Holzmaserung etc.)
//
// Texturen erzeugen wir prozedural via Canvas - das vermeidet das Bundling
// von Texturdateien und bleibt offline-tauglich.

export type MaterialPreset =
  | 'custom'
  | 'wood-oak'
  | 'wood-walnut'
  | 'wood-birch'
  | 'steel'
  | 'aluminum'
  | 'brass'
  | 'plastic-white'
  | 'plastic-black'
  | 'glass';

export interface MaterialDefinition {
  /** Eindeutiger Schluessel zum Erkennen */
  preset: MaterialPreset;
  /** Anzeigename in der UI */
  label: string;
  /** Hex-Farbe als Default */
  color: string;
  metalness: number;
  roughness: number;
  /** Optionale prozedurale Textur */
  texture?: 'wood-grain' | 'brushed-metal' | 'noise';
  /** Bei holz: ausrichtung der Maserung */
  textureRotation?: number;
  /** Skalierung der prozeduralen Textur in mm */
  textureScale?: number;
  /** Transparenz 0..1 */
  opacity?: number;
}

/**
 * Preset-Katalog. Werte sind handgestimmt - kein physikalisch korrektes Rendering,
 * aber visuell ueberzeugend genug fuer einen Konfigurator.
 */
export const MATERIAL_PRESETS: Record<MaterialPreset, MaterialDefinition> = {
  custom: {
    preset: 'custom',
    label: 'Custom',
    color: '#b8c4d0',
    metalness: 0.1,
    roughness: 0.55,
  },
  'wood-oak': {
    preset: 'wood-oak',
    label: 'Eiche',
    color: '#b8956a',
    metalness: 0.0,
    roughness: 0.78,
    texture: 'wood-grain',
    textureScale: 50,
  },
  'wood-walnut': {
    preset: 'wood-walnut',
    label: 'Nussbaum',
    color: '#5d3a22',
    metalness: 0.0,
    roughness: 0.7,
    texture: 'wood-grain',
    textureScale: 50,
  },
  'wood-birch': {
    preset: 'wood-birch',
    label: 'Birke',
    color: '#e0c890',
    metalness: 0.0,
    roughness: 0.8,
    texture: 'wood-grain',
    textureScale: 70,
  },
  steel: {
    preset: 'steel',
    label: 'Stahl',
    color: '#9aa3ad',
    metalness: 0.92,
    roughness: 0.42,
    texture: 'brushed-metal',
    textureScale: 20,
  },
  aluminum: {
    preset: 'aluminum',
    label: 'Aluminium',
    color: '#c9ccd1',
    metalness: 0.85,
    roughness: 0.32,
    texture: 'brushed-metal',
    textureScale: 25,
  },
  brass: {
    preset: 'brass',
    label: 'Messing',
    color: '#c2a06a',
    metalness: 0.95,
    roughness: 0.35,
    texture: 'brushed-metal',
    textureScale: 25,
  },
  'plastic-white': {
    preset: 'plastic-white',
    label: 'Kunststoff weiß',
    color: '#eeeeee',
    metalness: 0.0,
    roughness: 0.55,
  },
  'plastic-black': {
    preset: 'plastic-black',
    label: 'Kunststoff schwarz',
    color: '#202225',
    metalness: 0.0,
    roughness: 0.55,
  },
  glass: {
    preset: 'glass',
    label: 'Glas',
    color: '#d6e8f0',
    metalness: 0.0,
    roughness: 0.05,
    opacity: 0.35,
  },
};

export const MATERIAL_PRESET_LIST: MaterialPreset[] = [
  'custom',
  'wood-oak', 'wood-walnut', 'wood-birch',
  'steel', 'aluminum', 'brass',
  'plastic-white', 'plastic-black',
  'glass',
];
