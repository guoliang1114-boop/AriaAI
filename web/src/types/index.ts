/**
 * @deprecated This file is deprecated. Use `types/api.ts` for API types
 * and `types/enums.ts` for enums and constants.
 * 
 * Re-exporting from new locations for backward compatibility.
 */

// Re-export all enums from enums.ts
export * from './enums'

// Re-export API types (snake_case, backend-aligned)
export type { 
  User,
  Conversation,
  Message,
  Skill,
  Project,
  LoginRequest,
  LoginResponse,
} from './api'
