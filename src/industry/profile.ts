export type IndustryProfile = {
  subcategory: string;
  vertical: string;

  coreKeywords: string[];
  serviceKeywords: string[];

  descriptionTemplate: (ctx: {
    name: string;
    region: string;
    services: string[];
    trust: string[];
    cta: string;
  }) => string;

  directionsTemplate: (region: string) => string;

  photoChecklist: string[];
  bannedPhrases: string[];
};
