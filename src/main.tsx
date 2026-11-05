import React, { useEffect } from 'react';
import { render, Text } from 'ink';

function Boot() {
  useEffect(() => {
    const t = setTimeout(() => process.exit(0), 3000);
    return () => clearTimeout(t);
  }, []);
  return <Text color="cyan">TOKEN SPEED boot…</Text>;
}

render(React.createElement(Boot));
