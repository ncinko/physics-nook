export type PieceTemplateId =
  | 'station'
  | 'straight'
  | 'slope'
  | 'flat-turn'
  | 'banked-turn'
  | 'lift'
  | 'drop'
  | 'brake'
  | 'loop';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrackTransform {
  position: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface TrackFlags {
  station?: boolean;
  lift?: boolean;
  brake?: boolean;
  loop?: boolean;
}

export interface PieceVariant {
  id: string;
  label: string;
  yawDelta?: number;
  pitchDelta?: number;
  heightDelta?: number;
  bankAngle?: number;
  targetSpeed?: number;
}

export interface PieceTemplate {
  id: PieceTemplateId;
  label: string;
  shortLabel: string;
  length: number;
  radius?: number;
  flags?: TrackFlags;
  variants: PieceVariant[];
}

export interface TrackSample {
  position: Vec3;
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
  curvatureNormal: Vec3;
  arclength: number;
  curvature: number;
  slope: number;
  roll: number;
  segmentId: string;
  flags: TrackFlags;
}

export interface TrackSegment {
  id: string;
  templateId: PieceTemplateId;
  label: string;
  variant: PieceVariant;
  connector: TrackTransform;
  endTransform: TrackTransform;
  length: number;
  samples: TrackSample[];
  flags: TrackFlags;
}

export interface TrainConfig {
  carCount: number;
  massKg: number;
  initialSpeed: number;
  chainSpeed: number;
  brakeSpeed: number;
}

export interface Coaster {
  id: string;
  name: string;
  stationSegmentId: string;
  segments: TrackSegment[];
  train: TrainConfig;
}

export interface TerrainSettings {
  groundY: number;
  gridSize: number;
}

export interface SceneryItem {
  id: string;
  kind: 'tree' | 'lamp' | 'bench';
  position: Vec3;
}

export interface ParkDocument {
  schemaVersion: 1;
  version: number;
  terrain: TerrainSettings;
  scenery: SceneryItem[];
  coasters: Coaster[];
}

interface BaseParkOp {
  type: string;
  clientId: string;
  clientOpId: string;
  baseVersion: number;
  createdAt: number;
}

export interface AppendPieceOp extends BaseParkOp {
  type: 'appendPiece';
  coasterId: string;
  segment: TrackSegment;
}

export interface UndoLastPieceOp extends BaseParkOp {
  type: 'undoLastPiece';
  coasterId: string;
}

export interface DeleteCoasterOp extends BaseParkOp {
  type: 'deleteCoaster';
  coasterId: string;
}

export interface ReplaceParkOp extends BaseParkOp {
  type: 'replacePark';
  document: ParkDocument;
}

export interface StartRunOp extends BaseParkOp {
  type: 'startRun';
  coasterId: string;
  serverTime?: number;
  seed: number;
}

export interface PresenceState {
  clientId: string;
  name: string;
  color: string;
  roomCode?: string;
  selectedPiece?: PieceTemplateId;
  focus?: Vec3;
}

export interface UpdatePresenceOp extends BaseParkOp {
  type: 'updatePresence';
  presence: PresenceState;
}

export type ParkOp =
  | AppendPieceOp
  | UndoLastPieceOp
  | DeleteCoasterOp
  | ReplaceParkOp
  | StartRunOp
  | UpdatePresenceOp;

export interface PreviewResult {
  segment: TrackSegment;
  valid: boolean;
  reason: string;
}
