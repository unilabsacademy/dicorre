declare module 'dcmjs' {
  export namespace data {
    export class DicomMessage {
      static readFile(buffer: ArrayBuffer): DicomMessage
      constructor(dict: any)
      dict: any
      write(): ArrayBuffer
    }
    
    export class DicomMetaDictionary {
      static naturalizeDataset(dict: any): any
    }
  }
}