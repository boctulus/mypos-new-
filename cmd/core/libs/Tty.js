import boxen from 'boxen';

function printBox(text, innerWidth = 65, borderStyle = 'single', textAlignment = 'left') {
  console.log(
    boxen(text, {
      borderStyle: borderStyle,
      padding: { left: 1, right: 1 },
      width: innerWidth,           // ancho interior fijo
      textAlignment: textAlignment,
    })
  );
}

export default { printBox };
