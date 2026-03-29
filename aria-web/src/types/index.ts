export interface User {
  id: number
  email: string
  displayName: string
  isAdmin: boolean
}

export interface Conversation {
  id: number
  title: string
  projectId?: number
  skillId?: number
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: number
  conversationId: number
  role: 'user' | 'assistant'
  content: string
  metadataJson?: string
  createdAt: string
}

export interface Skill {
  id: number
  name: string
  category: string
  description: string
  systemPrompt: string
  userTemplate: string
  estimatedTime: string
  toolsDefinitionJson: string
  isGuidedWorkflow: boolean
}

export interface Project {
  id: number
  name: string
  client: string
  description: string
  status: string
  contextFreshness: number
  contractAmount: number
  contextSummary: string
  createdAt: string
  updatedAt: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  user: User
}
