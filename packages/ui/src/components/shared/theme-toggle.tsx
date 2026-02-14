import { useEffect, useState } from "react";

import { Moon, Sun } from "lucide-react";

import { Button } from "../ui/button";

export function ThemeToggle() {
  // Initialize state based on the class set by the inline script
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    // Toggle the 'dark' class on the root HTML element
    document.documentElement.classList.toggle("dark", newMode);
    // Persist the user's preference in localStorage
    localStorage.setItem("theme", newMode ? "dark" : "light");
  };

  return (
    <Button
      onClick={toggleTheme}
      variant="ghost"
      size="sm"
      className="hover:text-primary"
    >
      {isDarkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
