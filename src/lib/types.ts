export type DirectionCode = string;
export type DayType = "WEEKDAY" | "WEEKEND";
export type RecommendationMode = "seat";
export type DoorHintKind = "transfer" | "facility";
export type RecommendationGrade = "HIGH" | "MEDIUM" | "LOW";

export interface Station {
  operator: string;
  lineNo: string;
  stationCode: string;
  stationName: string;
  sequenceNo: number;
}

export interface TrainLayout {
  operator: string;
  lineNo: string;
  branchCode: string;
  direction: DirectionCode;
  carCount: number;
  doorsPerCar: number;
  source: string;
  confidence: number;
  validFrom: string;
  validTo: string | null;
}

export interface RidershipProfile {
  lineNo: string;
  stationName: string;
  dayType: DayType;
  timeSlot: string;
  boardings: number;
  alightings: number;
  source: string;
  observedMonth: string;
}

export interface CongestionProfile {
  lineNo: string;
  direction: DirectionCode;
  dayType: DayType;
  timeSlot: string;
  congestionPct: number;
  source: string;
}

export interface StationCongestionProfile {
  lineNo: string;
  stationName: string;
  direction: DirectionCode;
  dayType: DayType;
  timeSlot: string;
  congestionPct: number;
  source: string;
}

export interface TransferDemandProfile {
  lineNo: string;
  stationName: string;
  dayType: DayType;
  transferPassengers: number;
  source: string;
  observedOn: string;
}

export interface DoorHint {
  kind: DoorHintKind;
  lineNo: string;
  stationName: string;
  direction: DirectionCode;
  carNo: number;
  doorNo: number;
  weight: number;
  description: string;
  source: string;
  confidence: number;
}

export interface SeatChanceDataset {
  stations: Station[];
  trainLayouts: TrainLayout[];
  ridershipProfiles: RidershipProfile[];
  congestionProfiles: CongestionProfile[];
  stationCongestionProfiles: StationCongestionProfile[];
  transferDemandProfiles: TransferDemandProfile[];
  doorHints: DoorHint[];
}

export interface RecommendationRequest {
  origin: string;
  destination: string;
  lineNo: string;
  direction: DirectionCode;
  dayType: DayType;
  timeSlot: string;
  mode: RecommendationMode;
}

export interface Recommendation {
  rank: number;
  car_no: number;
  door_no: number;
  score: number;
  grade: RecommendationGrade;
  expected_seat_window: string;
  reasons: string[];
}

export interface RecommendationResponse {
  origin: string;
  destination: string;
  line_no: string;
  direction: DirectionCode;
  day_type: DayType;
  time_slot: string;
  recommendations: Recommendation[];
  cautions: string[];
}
