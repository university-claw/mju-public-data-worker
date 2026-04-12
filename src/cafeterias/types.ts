export interface CafeteriaInstagramSource {
  id: string;
  name: string;
  description: string;
  profileUrl: string;
  instagramUsername: string;
  menuImageGroup: string;
  supportsWeekendMenu: boolean;
}

export interface CafeteriaInstagramPost {
  sourceId: string;
  postCode: string;
  profileUrl: string;
  permalink: string;
  caption?: string;
  postedAt: string;
  postedAtEpoch: number;
  imageUrl?: string;
  rawItem: unknown;
}
