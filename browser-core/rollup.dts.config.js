import dts from 'rollup-plugin-dts';

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es'
    },
    plugins: [dts()],
  },
  {
    input: 'src/recorder.ts',
    output: {
      file: 'dist/recorder.d.ts',
      format: 'es'
    },
    plugins: [dts()],
  },
  {
    input: 'src/player.ts',
    output: {
      file: 'dist/player.d.ts',
      format: 'es'
    },
    plugins: [dts()],
  }
];

