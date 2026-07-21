import { createContext, useContext, useEffect, useState } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { vmm } from '../api/vmm';

const AuthContext = createContext(null);

// Hardcoded super-admins — bypass MySQL, always have full access
const SUPER_ADMIN_EMAILS = ['inder@openmind.in', 'amandeep@openmind.in'];

export function AuthProvider({ children }) {
  const { accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [currentUser, setCurrentUser] = useState(null);
  const [roleLoading, setRoleLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !accounts[0]) {
      setCurrentUser(null);
      return;
    }
    const msEmail = accounts[0].username;
    const msName  = accounts[0].name || msEmail;

    // Super admins get in immediately without a DB lookup
    if (SUPER_ADMIN_EMAILS.includes(msEmail.toLowerCase())) {
      setCurrentUser({ id: 0, name: msName, email: msEmail, role: 'admin', type: 'superadmin' });
      return;
    }

    setRoleLoading(true);
    vmm.getUserRole(msEmail)
      .then(res => {
        if (res.found) {
          setCurrentUser({
            id:    res.user.id,
            name:  res.user.name || msName,
            email: msEmail,
            role:  res.user.role,
            type:  res.user.type,
          });
        } else {
          setCurrentUser(null);
        }
      })
      .catch(() => setCurrentUser(null))
      .finally(() => setRoleLoading(false));
  }, [isAuthenticated, accounts]);

  return (
    <AuthContext.Provider value={{ currentUser, roleLoading, setCurrentUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
