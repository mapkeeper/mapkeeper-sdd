declare module 'jest-axe' {
  interface AxeViolation {
    id: string;
    impact?: string | null;
    description: string;
  }

  interface AxeResults {
    violations: AxeViolation[];
  }

  export function axe(element: Element): Promise<AxeResults>;
}
