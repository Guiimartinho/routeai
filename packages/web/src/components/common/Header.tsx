import { useAuthStore } from '../../stores/authStore';
import { useNavigate } from 'react-router-dom';
import {
  CircuitBoard,
  LogOut,
  User,
  ChevronDown,
  Settings,
  CreditCard,
  HelpCircle,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export default function Header() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="h-14 bg-gray-900 border-b border-gray-800 shrink-0">
      <div className="max-w-7xl mx-auto h-full flex items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center">
            <CircuitBoard className="w-5 h-5 text-brand-400" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight">RouteAI</span>
        </button>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {/* Help link */}
          <a
            href="#"
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Help & Documentation"
          >
            <HelpCircle className="w-4 h-4" />
          </a>

          {/* User menu */}
          {user && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors outline-none">
                  <div className="w-7 h-7 rounded-full bg-brand-600/30 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-brand-400" />
                  </div>
                  <span className="hidden sm:inline">{user.name}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-1 z-50 animate-in fade-in slide-in-from-top-2"
                  sideOffset={8}
                  align="end"
                >
                  {/* User info */}
                  <div className="px-3 py-2 border-b border-gray-700 mb-1">
                    <p className="text-sm font-medium text-gray-200">{user.name}</p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                    <p className="text-[10px] text-brand-400 uppercase mt-1">{user.tier} plan</p>
                  </div>

                  <DropdownMenu.Item className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded cursor-pointer outline-none">
                    <Settings className="w-3.5 h-3.5" />
                    Settings
                  </DropdownMenu.Item>

                  <DropdownMenu.Item className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded cursor-pointer outline-none">
                    <CreditCard className="w-3.5 h-3.5" />
                    Billing
                  </DropdownMenu.Item>

                  <DropdownMenu.Separator className="h-px bg-gray-700 my-1" />

                  <DropdownMenu.Item
                    onSelect={handleLogout}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded cursor-pointer outline-none"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
      </div>
    </header>
  );
}
