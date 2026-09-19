import { createContext, useContext } from 'react'

interface AuthContextType {
  isAuthenticated: boolean
  login: (token: string, user: unknown) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
