import { Type } from "@google/genai";

export interface ClinicalRule {
  criteria: string;
  service: string;
  appointment: string;
  photo: string;
  notes: string;
  redFlags: string;
  contacts: string;
}

export interface Problem {
  name: string;
  rules: ClinicalRule[];
}

export interface Section {
  name: string;
  problems: Problem[];
}

export interface NavigationData {
  meta: {
    sourceFile: string;
    builtAt: string;
    sheetsUsed: Record<string, string>;
    counts: Record<string, unknown>;
  };
  sections: {
    Adults: Section[];
    Paeds: Section[];
    Admin: Section[];
  };
}

// Tool Arguments Types
export interface RoutingResultArgs {
  service: string;
  appointment: string;
  notes: string;
  redFlags: string;
  isEmergency: boolean;
  rationale: string;
}

// UI Types
export enum AgentState {
  IDLE = 'idle',
  LISTENING = 'listening',
  SPEAKING = 'speaking',
  PROCESSING = 'processing',
  ERROR = 'error'
}

export interface LogMessage {
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: number;
}

export const RoutingToolDeclaration = {
  name: 'displayRoutingResult',
  parameters: {
    type: Type.OBJECT,
    description: 'Display the final clinical routing decision to the user on the screen.',
    properties: {
      service: {
        type: Type.STRING,
        description: 'The medical service provider (e.g., GP, A&E, Pharmacy).',
      },
      appointment: {
        type: Type.STRING,
        description: 'The timeframe or type of appointment (e.g., Urgent, F2F 2-5 days).',
      },
      notes: {
        type: Type.STRING,
        description: 'Special instructions or notes for the patient.',
      },
      redFlags: {
        type: Type.STRING,
        description: 'Specific red flags that were checked or warned about.',
      },
      isEmergency: {
        type: Type.BOOLEAN,
        description: 'True if the routing is to A&E or requires immediate 999 assistance.',
      },
      rationale: {
        type: Type.STRING,
        description: 'Brief explanation of why this route was chosen (e.g., "Due to severe pain and duration > 3 days").',
      },
    },
    required: ['service', 'appointment', 'isEmergency'],
  },
};
