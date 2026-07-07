export type RoomRules = {
  pointBuyLimit: number;
  occupationSkillLimit: number;
  interestSkillLimit: number;
};

export const DEFAULT_ROOM_RULES: RoomRules = {
  pointBuyLimit: 480,
  occupationSkillLimit: 80,
  interestSkillLimit: 70,
};
