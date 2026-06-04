import type { Language } from './types'

export interface ConsentSection {
  heading: string
  body: string
}

export interface ConsentStrings {
  dir: 'ltr' | 'rtl'
  docTitle: string
  labels: {
    patient: string
    patientId: string
    dob: string
    date: string
    clinic: string
    phone: string
    address: string
    license: string
  }
  sections: ConsentSection[]
  acknowledgement: string
  signatureLabel: string
  signatoryNameLabel: string
  signedDateLabel: string
  providerLabel: string
  providerSignatureLabel: string
}

// Standard, professional dental-practice consent language. The clinic should have its
// legal counsel review/customise this content (editable in Settings → Form Templates).
export const CONSENT_CONTENT: Record<Language, ConsentStrings> = {
  english: {
    dir: 'ltr',
    docTitle: 'Informed Consent for Dental Treatment',
    labels: {
      patient: 'Patient',
      patientId: 'Patient ID',
      dob: 'Date of Birth',
      date: 'Date',
      clinic: 'Clinic',
      phone: 'Phone',
      address: 'Address',
      license: 'License #'
    },
    sections: [
      {
        heading: '1. Consent to Dental Treatment',
        body: 'I voluntarily consent to and authorize the dentists, hygienists, and staff of this clinic to perform dental examinations, cleanings, diagnostic procedures (including x-rays), and the dental treatment that has been explained to me. I understand that dentistry is not an exact science and that no guarantee has been made regarding the results of any treatment.'
      },
      {
        heading: '2. Privacy & HIPAA Notice',
        body: 'I acknowledge that I have been informed of the clinic’s privacy practices regarding my protected health information. My records are kept confidential and will only be released as permitted or required by law, for treatment, payment, or healthcare operations, or with my written authorization.'
      },
      {
        heading: '3. Liability & Assumption of Risk',
        body: 'I understand that all dental and surgical procedures carry inherent risks, including but not limited to pain, swelling, infection, bleeding, sensitivity, and reaction to anesthesia. I accept these risks and release the clinic and its providers from liability for results that are not due to negligence, having had the opportunity to ask questions and receive answers to my satisfaction.'
      },
      {
        heading: '4. Emergency Treatment Authorization',
        body: 'In the event of a medical or dental emergency during my visit, I authorize the providers to administer such emergency care as they deem necessary for my health and safety, including contacting emergency medical services.'
      },
      {
        heading: '5. Right to Refuse Treatment',
        body: 'I understand that I have the right to refuse any recommended treatment at any time and to be informed of the consequences of such refusal. Consent given here may be withdrawn by me at any time prior to the procedure.'
      },
      {
        heading: '6. Financial & Payment Terms',
        body: 'I understand that I am financially responsible for all charges for services rendered, regardless of insurance coverage. I agree to the clinic’s payment terms and understand that estimates of cost are not a guarantee of final charges or of insurance reimbursement.'
      }
    ],
    acknowledgement:
      'I have read (or had read to me) the information above, I understand it, and I have had the opportunity to ask questions. By signing below I consent to treatment under the terms described.',
    signatureLabel: 'Patient / Guardian Signature',
    signatoryNameLabel: 'Name',
    signedDateLabel: 'Date Signed',
    providerLabel: 'Provider',
    providerSignatureLabel: 'Provider Signature (optional)'
  },

  spanish: {
    dir: 'ltr',
    docTitle: 'Consentimiento Informado para Tratamiento Dental',
    labels: {
      patient: 'Paciente',
      patientId: 'ID del Paciente',
      dob: 'Fecha de Nacimiento',
      date: 'Fecha',
      clinic: 'Clínica',
      phone: 'Teléfono',
      address: 'Dirección',
      license: 'Nº de Licencia'
    },
    sections: [
      {
        heading: '1. Consentimiento para el Tratamiento Dental',
        body: 'Doy mi consentimiento voluntario y autorizo a los dentistas, higienistas y personal de esta clínica a realizar exámenes dentales, limpiezas, procedimientos de diagnóstico (incluidas radiografías) y el tratamiento dental que me ha sido explicado. Entiendo que la odontología no es una ciencia exacta y que no se ha garantizado ningún resultado del tratamiento.'
      },
      {
        heading: '2. Aviso de Privacidad y HIPAA',
        body: 'Reconozco que he sido informado sobre las prácticas de privacidad de la clínica respecto a mi información médica protegida. Mis registros se mantienen confidenciales y solo se divulgarán según lo permita o exija la ley, para tratamiento, pago u operaciones de atención médica, o con mi autorización por escrito.'
      },
      {
        heading: '3. Responsabilidad y Asunción de Riesgos',
        body: 'Entiendo que todos los procedimientos dentales y quirúrgicos conllevan riesgos inherentes, incluidos, entre otros, dolor, inflamación, infección, sangrado, sensibilidad y reacción a la anestesia. Acepto estos riesgos y libero a la clínica y a sus proveedores de responsabilidad por resultados que no se deban a negligencia, habiendo tenido la oportunidad de hacer preguntas y recibir respuestas a mi satisfacción.'
      },
      {
        heading: '4. Autorización para Tratamiento de Emergencia',
        body: 'En caso de una emergencia médica o dental durante mi visita, autorizo a los proveedores a administrar la atención de emergencia que consideren necesaria para mi salud y seguridad, incluido el contacto con los servicios médicos de emergencia.'
      },
      {
        heading: '5. Derecho a Rechazar el Tratamiento',
        body: 'Entiendo que tengo derecho a rechazar cualquier tratamiento recomendado en cualquier momento y a ser informado de las consecuencias de dicha negativa. El consentimiento otorgado aquí puede ser retirado por mí en cualquier momento antes del procedimiento.'
      },
      {
        heading: '6. Condiciones Financieras y de Pago',
        body: 'Entiendo que soy responsable financieramente de todos los cargos por los servicios prestados, independientemente de la cobertura del seguro. Acepto las condiciones de pago de la clínica y entiendo que las estimaciones de costo no son una garantía de los cargos finales ni del reembolso del seguro.'
      }
    ],
    acknowledgement:
      'He leído (o me han leído) la información anterior, la entiendo y he tenido la oportunidad de hacer preguntas. Al firmar a continuación, doy mi consentimiento para el tratamiento bajo los términos descritos.',
    signatureLabel: 'Firma del Paciente / Tutor',
    signatoryNameLabel: 'Nombre',
    signedDateLabel: 'Fecha de Firma',
    providerLabel: 'Proveedor',
    providerSignatureLabel: 'Firma del Proveedor (opcional)'
  },

  arabic: {
    dir: 'rtl',
    docTitle: 'الموافقة المستنيرة على العلاج السني',
    labels: {
      patient: 'المريض',
      patientId: 'رقم المريض',
      dob: 'تاريخ الميلاد',
      date: 'التاريخ',
      clinic: 'العيادة',
      phone: 'الهاتف',
      address: 'العنوان',
      license: 'رقم الترخيص'
    },
    sections: [
      {
        heading: '١. الموافقة على العلاج السني',
        body: 'أوافق طوعًا وأفوّض أطباء الأسنان وأخصائيي الصحة والموظفين في هذه العيادة بإجراء الفحوصات والتنظيف والإجراءات التشخيصية (بما في ذلك الأشعة) والعلاج الذي تم شرحه لي. وأدرك أن طب الأسنان ليس علمًا دقيقًا وأنه لا توجد أي ضمانات بشأن نتائج العلاج.'
      },
      {
        heading: '٢. إشعار الخصوصية',
        body: 'أقر بأنني أُبلِغت بممارسات الخصوصية الخاصة بالعيادة فيما يتعلق بمعلوماتي الصحية المحمية. تُحفظ سجلاتي بسرية ولن يتم الإفصاح عنها إلا بما يسمح به أو يتطلبه القانون، أو لأغراض العلاج والدفع، أو بإذن كتابي مني.'
      },
      {
        heading: '٣. المسؤولية وتحمل المخاطر',
        body: 'أدرك أن جميع إجراءات الأسنان والجراحة تنطوي على مخاطر متأصلة، تشمل على سبيل المثال لا الحصر الألم والتورم والعدوى والنزيف والحساسية ورد الفعل تجاه التخدير. وأقبل هذه المخاطر وأُعفي العيادة ومقدمي الخدمة من المسؤولية عن النتائج التي لا تنتج عن الإهمال.'
      },
      {
        heading: '٤. التفويض بالعلاج الطارئ',
        body: 'في حالة حدوث طارئ طبي أو سني أثناء زيارتي، أفوّض مقدمي الخدمة بتقديم الرعاية الطارئة التي يرونها ضرورية لصحتي وسلامتي، بما في ذلك الاتصال بخدمات الطوارئ.'
      },
      {
        heading: '٥. الحق في رفض العلاج',
        body: 'أدرك أن لي الحق في رفض أي علاج موصى به في أي وقت وأن أُبلّغ بعواقب هذا الرفض. ويمكنني سحب الموافقة الممنوحة هنا في أي وقت قبل الإجراء.'
      },
      {
        heading: '٦. الشروط المالية وشروط الدفع',
        body: 'أدرك أنني مسؤول ماليًا عن جميع رسوم الخدمات المقدمة، بغض النظر عن تغطية التأمين. وأوافق على شروط الدفع الخاصة بالعيادة وأدرك أن تقديرات التكلفة ليست ضمانًا للرسوم النهائية أو لاسترداد التأمين.'
      }
    ],
    acknowledgement:
      'لقد قرأت (أو قُرئت عليّ ) المعلومات الواردة أعلاه وأفهمها وأتيحت لي الفرصة لطرح الأسئلة. وبالتوقيع أدناه أوافق على العلاج وفق الشروط الموضحة.',
    signatureLabel: 'توقيع المريض / ولي الأمر',
    signatoryNameLabel: 'الاسم',
    signedDateLabel: 'تاريخ التوقيع',
    providerLabel: 'مقدم الخدمة',
    providerSignatureLabel: 'توقيع مقدم الخدمة (اختياري)'
  }
}
