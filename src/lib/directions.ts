export function forwardDirectionName(lineNo: string, terminalStationName: string) {
  return lineNo === "2" ? "내선" : terminalStationName;
}

export function reverseDirectionName(lineNo: string, terminalStationName: string) {
  return lineNo === "2" ? "외선" : terminalStationName;
}
