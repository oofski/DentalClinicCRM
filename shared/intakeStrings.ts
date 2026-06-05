// Localized strings for the patient intake form + kiosk. The doctor portal always uses
// English; the patient Check-In kiosk renders in the patient's chosen language.
import type { Language } from './types'

export interface PickOption {
  key: string // canonical English value stored in the database
  en: string
  es: string
  ar: string
}

export const COMMON_ALLERGIES: PickOption[] = [
  { key: 'Penicillin', en: 'Penicillin', es: 'Penicilina', ar: 'البنسلين' },
  { key: 'Latex', en: 'Latex', es: 'Látex', ar: 'اللاتكس' },
  { key: 'Aspirin/NSAIDs', en: 'Aspirin/NSAIDs', es: 'Aspirina/AINE', ar: 'الأسبرين/مضادات الالتهاب' },
  { key: 'Local anesthetic', en: 'Local anesthetic', es: 'Anestesia local', ar: 'التخدير الموضعي' },
  { key: 'Sulfa drugs', en: 'Sulfa drugs', es: 'Sulfamidas', ar: 'أدوية السلفا' },
  { key: 'Codeine', en: 'Codeine', es: 'Codeína', ar: 'الكوديين' },
  { key: 'None', en: 'None', es: 'Ninguna', ar: 'لا يوجد' }
]

export const COMMON_CONDITIONS: PickOption[] = [
  { key: 'Diabetes', en: 'Diabetes', es: 'Diabetes', ar: 'السكري' },
  { key: 'High blood pressure', en: 'High blood pressure', es: 'Presión arterial alta', ar: 'ارتفاع ضغط الدم' },
  { key: 'Heart disease', en: 'Heart disease', es: 'Enfermedad cardíaca', ar: 'أمراض القلب' },
  { key: 'Asthma', en: 'Asthma', es: 'Asma', ar: 'الربو' },
  { key: 'Bleeding disorder', en: 'Bleeding disorder', es: 'Trastorno hemorrágico', ar: 'اضطراب النزيف' },
  { key: 'Pregnancy', en: 'Pregnancy', es: 'Embarazo', ar: 'الحمل' },
  { key: 'None', en: 'None', es: 'Ninguna', ar: 'لا يوجد' }
]

export function optLabel(opt: PickOption, lang: Language): string {
  return lang === 'spanish' ? opt.es : lang === 'arabic' ? opt.ar : opt.en
}

export interface IntakeStrings {
  dir: 'ltr' | 'rtl'
  sectionPersonal: string
  sectionContact: string
  sectionMedical: string
  sectionDental: string
  firstName: string
  lastName: string
  dob: string
  language: string
  phone: string
  email: string
  address: string
  emergencyName: string
  emergencyPhone: string
  allergies: string
  conditions: string
  medications: string
  dentalHistory: string
  other: string
  otherPlaceholder: string
  requiredNote: string
  // Kiosk
  welcomeTitle: string
  welcomeBody: string
  begin: string
  yourInfo: string
  continueConsent: string
  consentTitle: string
  consentReview: string
  thankYouTitle: string
  thankYouBody: string
  newCheckIn: string
  cancel: string
  chooseLanguage: string
  readAloud: string
  stopReading: string
  acceptSave: string
  signatureTitle: string
}

export const INTAKE_STRINGS: Record<Language, IntakeStrings> = {
  english: {
    dir: 'ltr',
    sectionPersonal: 'Personal',
    sectionContact: 'Contact',
    sectionMedical: 'Medical History',
    sectionDental: 'Dental History',
    firstName: 'First Name',
    lastName: 'Last Name',
    dob: 'Date of Birth',
    language: 'Preferred Language',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    emergencyName: 'Emergency Contact Name',
    emergencyPhone: 'Emergency Contact Phone',
    allergies: 'Allergies',
    conditions: 'Medical Conditions',
    medications: 'Current Medications',
    dentalHistory: 'Dental History (previous treatments, implants, etc.)',
    other: 'Other',
    otherPlaceholder: 'Other (please specify)',
    requiredNote: 'Fields marked * are required.',
    welcomeTitle: 'Welcome to Giving Smiles',
    welcomeBody:
      'Please check in for your appointment. It only takes a few minutes — your information stays private and secure on the clinic’s computer.',
    begin: 'Begin Check-In',
    yourInfo: 'Your Information',
    continueConsent: 'Continue to Consent →',
    consentTitle: 'Consent Form',
    consentReview: 'Please review and sign below.',
    thankYouTitle: 'Thank you!',
    thankYouBody:
      'You’re all checked in. Please hand the device back to the front desk — your dentist will see you shortly.',
    newCheckIn: 'Start a New Check-In',
    cancel: 'Cancel',
    chooseLanguage: 'Choose your language',
    readAloud: 'Read aloud',
    stopReading: 'Stop',
    acceptSave: 'Accept & Save Consent',
    signatureTitle: 'Signature'
  },
  spanish: {
    dir: 'ltr',
    sectionPersonal: 'Personal',
    sectionContact: 'Contacto',
    sectionMedical: 'Historial Médico',
    sectionDental: 'Historial Dental',
    firstName: 'Nombre',
    lastName: 'Apellido',
    dob: 'Fecha de Nacimiento',
    language: 'Idioma Preferido',
    phone: 'Teléfono',
    email: 'Correo Electrónico',
    address: 'Dirección',
    emergencyName: 'Nombre del Contacto de Emergencia',
    emergencyPhone: 'Teléfono del Contacto de Emergencia',
    allergies: 'Alergias',
    conditions: 'Condiciones Médicas',
    medications: 'Medicamentos Actuales',
    dentalHistory: 'Historial dental (tratamientos previos, implantes, etc.)',
    other: 'Otro',
    otherPlaceholder: 'Otro (especifique)',
    requiredNote: 'Los campos marcados con * son obligatorios.',
    welcomeTitle: 'Bienvenido a Giving Smiles',
    welcomeBody:
      'Por favor regístrese para su cita. Solo toma unos minutos — su información permanece privada y segura en la computadora de la clínica.',
    begin: 'Comenzar Registro',
    yourInfo: 'Su Información',
    continueConsent: 'Continuar al Consentimiento →',
    consentTitle: 'Formulario de Consentimiento',
    consentReview: 'Por favor revise y firme a continuación.',
    thankYouTitle: '¡Gracias!',
    thankYouBody:
      'Su registro está completo. Por favor devuelva el dispositivo a la recepción — su dentista lo atenderá en breve.',
    newCheckIn: 'Iniciar un Nuevo Registro',
    cancel: 'Cancelar',
    chooseLanguage: 'Elija su idioma',
    readAloud: 'Leer en voz alta',
    stopReading: 'Detener',
    acceptSave: 'Aceptar y Guardar Consentimiento',
    signatureTitle: 'Firma'
  },
  arabic: {
    dir: 'rtl',
    sectionPersonal: 'المعلومات الشخصية',
    sectionContact: 'معلومات الاتصال',
    sectionMedical: 'التاريخ الطبي',
    sectionDental: 'التاريخ السني',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    dob: 'تاريخ الميلاد',
    language: 'اللغة المفضلة',
    phone: 'الهاتف',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    emergencyName: 'اسم جهة اتصال الطوارئ',
    emergencyPhone: 'هاتف جهة اتصال الطوارئ',
    allergies: 'الحساسية',
    conditions: 'الحالات الطبية',
    medications: 'الأدوية الحالية',
    dentalHistory: 'التاريخ السني (علاجات سابقة، زرعات، إلخ.)',
    other: 'أخرى',
    otherPlaceholder: 'أخرى (يرجى التحديد)',
    requiredNote: 'الحقول المميزة بعلامة * مطلوبة.',
    welcomeTitle: 'مرحبًا بك في Giving Smiles',
    welcomeBody:
      'يرجى تسجيل الوصول لموعدك. لن يستغرق الأمر سوى بضع دقائق — تبقى معلوماتك خاصة وآمنة على حاسوب العيادة.',
    begin: 'بدء تسجيل الوصول',
    yourInfo: 'معلوماتك',
    continueConsent: '← المتابعة إلى الموافقة',
    consentTitle: 'نموذج الموافقة',
    consentReview: 'يرجى المراجعة والتوقيع أدناه.',
    thankYouTitle: 'شكرًا لك!',
    thankYouBody:
      'تم تسجيل وصولك. يرجى إعادة الجهاز إلى الاستقبال — سيراك طبيب الأسنان قريبًا.',
    newCheckIn: 'بدء تسجيل وصول جديد',
    cancel: 'إلغاء',
    chooseLanguage: 'اختر لغتك',
    readAloud: 'القراءة بصوت عالٍ',
    stopReading: 'إيقاف',
    acceptSave: 'قبول وحفظ الموافقة',
    signatureTitle: 'التوقيع'
  }
}
