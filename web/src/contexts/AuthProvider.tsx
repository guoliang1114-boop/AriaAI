import { useState, useEffect, type ReactNode } from 'react'
import { AuthContext } from './authState'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('authToken'))

  useEffect(() => {
    const handleStorage = () => {
      setIsAuthenticated(!!localStorage.getItem('authToken'))
    }
    const handleLogout = () => {
      setIsAuthenticated(false)
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('auth:logout', handleLogout)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('auth:logout', handleLogout)
    }
  }, [])

  const login = (token: string, user: unknown) => {
    localStorage.setItem('authToken', token)
    localStorage.setItem('user', JSON.stringify(user))
    setIsAuthenticated(true)
  }

  const logout = () => {
    localStorage.removeItem('authToken')
    localStorage.removeItem('user')
    setIsAuthenticated(false)
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
