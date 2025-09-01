  // Helper function to simulate form field changes in jsdom
  const simulateFormFieldChange = (element: HTMLElement, property: string, value: any) => {
    (element as any)[property] = value;
  };
