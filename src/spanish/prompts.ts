import { BLANK } from "./schemas.js";
import { LESSONS_PER_UNIT, type CefrLevel, type CoursePlan, type CourseUnit, type LearnerSnapshot, type Variant } from "./types.js";

const VARIANT_NORMS: Record<Variant, string> = {
  peninsular: "Use a norma peninsular padrão, com vosotros, e cite as variantes americanas quando forem relevantes: o DELE aceita as duas.",
  americana: "Use a norma americana culta: ustedes no lugar de vosotros e o léxico e os usos verbais mais comuns na América, como a preferência pelo pretérito indefinido. Mostre vosotros nas tabelas de conjugação como forma peninsular e cite as variantes da Espanha quando forem relevantes: o DELE aceita as duas.",
};

export function teacherSystem(variant: Variant): string {
  return `Você é o professor particular de espanhol deste aluno e autor do material das aulas dele. É especialista no ensino para brasileiros e na preparação para o DELE B2 do Instituto Cervantes. Você acompanha o aluno aula a aula: conhece o histórico dele, os erros que se repetem, o que ele já domina e o que ele quer, e ajusta cada aula, cada correção e cada explicação a ele.

O aluno é adulto, falante nativo de português do Brasil, e começou o curso com nível A2 avançado. A meta é chegar ao B2 e ser aprovado no DELE B2. As prioridades do curso, nesta ordem:
1. Ampliar o vocabulário: léxico frequente e útil do B1 e do B2, colocações, expressões e famílias de palavras, sempre em contexto.
2. Conectores do discurso: adição, contraste, concessão, causa, consequência, condição, finalidade, ordenação, reformulação, exemplificação e conclusão, com o registro adequado (oral, escrito, formal).
3. Conjugação verbal: todos os tempos do indicativo; subjuntivo presente, pretérito perfeito, imperfeito e mais-que-perfeito; imperativo afirmativo e negativo; condicional; perífrases; irregulares frequentes. Ensine também quando usar cada tempo.

Use a proximidade entre as línguas a favor do aluno. Aproveite os cognatos transparentes para acelerar o vocabulário e mostre as correspondências regulares (-ção/-ción, -dade/-dad, -vel/-ble, ...). Ao mesmo tempo, enfrente as interferências do português:
- ser e estar onde as línguas divergem: estar casado, está muerto, ser e estar com listo, rico, malo, aburrido, despierto, vivo, atento; ser para localizar eventos;
- falsos amigos: exquisito, embarazada, oficina, polvo, rato, largo, apellido, borrar, cena, pronto, ...;
- heterogenéricos (el puente, la leche, el árbol, la sal, el viaje, la nariz, el color), heterotônicos (democracia, nivel, teléfono) e heterossemânticos;
- "ficar" e os verbos de mudança: quedarse, ponerse, volverse, hacerse, quedar;
- futuro do subjuntivo e infinitivo pessoal do português, que não existem em espanhol (cuando vaya, para que vengáis);
- pretérito indefinido e pretérito perfecto, gustar e verbos parecidos, por e para, muy e mucho, apócope, o neutro lo, pronomes átonos e sua colocação, a diante de objeto direto de pessoa.

Escreva explicações, instruções e comentários em português do Brasil, curtos e diretos, falando com o aluno como "você". Escreva todo o espanhol de forma natural, correta e adequada ao nível pedido. ${VARIANT_NORMS[variant]}`;
}

const DELE_WRITING_WORDS: Record<CefrLevel, [number, number]> = {
  "A2+": [60, 90],
  B1: [100, 130],
  "B1+": [130, 160],
  B2: [150, 180],
};

interface LessonRole {
  name: string;
  brief: (unit: CourseUnit) => string;
}

export const LESSON_ROLES: readonly LessonRole[] = [
  {
    name: "Apresentação",
    brief: () => "Apresente o conteúdo gramatical e verbal da unidade com uma explicação clara e exemplos. Introduza de 10 a 12 palavras novas do tema. Faça de 12 a 14 exercícios que comecem guiados (escolha e lacuna) e terminem com uma ou duas traduções curtas. Sem texto de leitura.",
  },
  {
    name: "Prática",
    brief: () => "Treino intensivo de conjugação nos tempos da unidade (lacunas com o verbo no tempo e na pessoa certos) e dos contrastes com o português (ser e estar, falsos amigos, heterogenéricos). Introduza de 8 a 10 palavras novas. Faça de 14 a 16 exercícios e inclua uma escrita curta de 2 ou 3 frases. Sem texto de leitura.",
  },
  {
    name: "Uso em contexto",
    brief: () => "Escreva um texto de 150 a 250 palavras (artigo, e-mail, crônica ou diálogo) com as palavras e os conectores da unidade. Introduza de 6 a 8 palavras novas que apareçam no texto. Faça de 12 a 14 exercícios: compreensão do texto, escolha e lacuna de conectores, traduções do português e uma escrita curta com conectores obrigatórios.",
  },
  {
    name: "Revisão e tarefa DELE",
    brief: (unit) => {
      const [min, max] = DELE_WRITING_WORDS[unit.level];
      return `Revise a unidade inteira e as palavras pendentes de revisão. No máximo 4 palavras novas. Faça de 12 a 14 exercícios que misturem vocabulário, conectores e conjugação, e termine com uma tarefa de expressão escrita no formato do DELE adaptada ao nível ${unit.level} (de ${min} a ${max} palavras, com situação, destinatário e pontos obrigatórios).`;
    },
  },
];

export const REINFORCEMENT_NAME = "Aula de reforço";

export function planPrompt(): string {
  return `Monte o plano completo do curso, do A2+ ao B2, com 36 a 44 unidades progressivas: cerca de 8 no A2+, 12 no B1, 10 no B1+ e 12 no B2.

Cada unidade terá ${LESSONS_PER_UNIT} aulas: apresentação, prática, uso em contexto e revisão com tarefa no formato do DELE. Para cada unidade, informe:
- level, titleEs e titlePt;
- theme: o campo lexical da unidade, ligado aos temas do DELE B2 (trabalho, saúde, meio ambiente, tecnologia, educação, relações pessoais, cultura, consumo, viagens, sociedade, ciência, política, ...);
- grammar: os conteúdos gramaticais e verbais, citando os tempos verbais e as estruturas;
- connectors: os conectores e marcadores do discurso que a unidade ensina;
- contrasts: as interferências do português que a unidade trata (ser e estar, falsos amigos, heterogenéricos, verbos de mudança, ...);
- dele: a prova e a tarefa do DELE B2 que a unidade prepara.

Distribua os tempos verbais e os conectores em espiral: cada conteúdo aparece primeiro de forma simples e volta depois com mais exigência, até cobrir o que o DELE B2 cobra. As primeiras unidades consolidam o A2 (presente, pretéritos, futuro, imperativo) antes de entrar no subjuntivo.`;
}

function unitBrief(plan: CoursePlan, unitNumber: number): string {
  const unit = plan.units[unitNumber - 1];
  const previous = plan.units.slice(Math.max(0, unitNumber - 4), unitNumber - 1).map((item) => item.titleEs);
  return JSON.stringify({
    unidade: unitNumber,
    de: plan.units.length,
    nivel: unit.level,
    titulo: unit.titleEs,
    tema: unit.theme,
    gramatica: unit.grammar,
    conectores: unit.connectors,
    contrastes: unit.contrasts,
    dele: unit.dele,
    unidadesAnteriores: previous,
  }, null, 2);
}

function studentBrief(learner: LearnerSnapshot): string[] {
  const { student, examDaysLeft } = learner;
  const lines = [
    `- Objetivo: ${student.goal || "não informado (a meta do curso é o DELE B2)"}`,
    `- Prova do DELE: ${student.examDate && examDaysLeft !== null ? `em ${examDaysLeft} dias (${student.examDate})` : "data não informada"}`,
  ];
  if (student.interests) lines.push(`- Interesses: ${student.interests}`);
  if (student.notes) lines.push(`- Recado do aluno para o professor: ${student.notes}`);
  return lines;
}

function profileBrief(learner: LearnerSnapshot): string[] {
  const { profile } = learner;
  if (!profile) return ["Ainda não há diagnóstico do professor: use a estatística e os erros recentes abaixo."];
  const lines = [
    `Diagnóstico do professor (atualizado depois de ${profile.lessonsAnalyzed} aulas analisadas):`,
    `- Ritmo recomendado: ${profile.pace}`,
  ];
  if (profile.guidance) lines.push(`- Orientação para as próximas aulas: ${profile.guidance}`);
  if (profile.weaknesses.length > 0) {
    lines.push("- Pontos fracos, do mais para o menos prioritário:");
    for (const weakness of profile.weaknesses) {
      const examples = weakness.examples.map((example) => `"${example.wrong}" → "${example.right}"`).join("; ");
      lines.push(`  - [${weakness.priority} · ${weakness.skill} · ${weakness.trend}] ${weakness.title}. Regra: ${weakness.rule}${weakness.interference ? ` Interferência do português: ${weakness.interference}` : ""}${examples ? ` Erros reais: ${examples}` : ""}`);
    }
  }
  if (profile.strengths.length > 0) lines.push(`- Já domina: ${profile.strengths.join("; ")}`);
  return lines;
}

function learnerBrief(learner: LearnerSnapshot): string {
  const lines = ["Sobre o aluno:", ...studentBrief(learner), "", ...profileBrief(learner), ""];
  const { vocabulary } = learner;
  lines.push(`Vocabulário: ${vocabulary.total} palavras aprendidas, ${vocabulary.mastered} dominadas e ${vocabulary.due} pendentes de revisão.`);
  if (learner.knownLemmas.length > 0) {
    lines.push(`- Não apresente estas palavras como novas, mas reutilize-as à vontade: ${learner.knownLemmas.join(", ")}.`);
  }
  if (learner.dueWords.length > 0) {
    lines.push(`- Palavras para revisar nesta aula. Use cada uma em pelo menos um exercício e coloque o lemma dela em lemmas: ${learner.dueWords.map((word) => `${word.display} (${word.translation}) [lemma: ${word.lemma}]`).join("; ")}.`);
  }
  if (learner.leeches.length > 0) {
    lines.push(`- Palavras que o aluno erra com frequência. Volte a usá-las em contexto, com uma dica de memorização na explanation do exercício: ${learner.leeches.map((word) => `${word.display} (${word.translation}; ${word.wrong} erros e ${word.correct} acertos) [lemma: ${word.lemma}]`).join("; ")}.`);
  }
  if (learner.weakFocuses.length > 0) {
    lines.push(`Pontos com acerto baixo na estatística: ${learner.weakFocuses.map((item) => `${item.focus} (${item.skill}, ${Math.round(item.accuracy * 100)}% em ${item.attempts} tentativas)`).join("; ")}.`);
  }
  if (learner.recentErrors.length > 0) {
    lines.push("Erros recentes, do mais novo ao mais antigo. Retome-os sem repetir as mesmas frases:");
    for (const error of learner.recentErrors) lines.push(`- [${error.category} · ${error.focus}] "${error.wrong}" → "${error.correct}"`);
  }
  if (learner.recentTitles.length > 0) {
    lines.push(`Aulas recentes (não repita textos nem frases delas): ${learner.recentTitles.join("; ")}.`);
  }
  return lines.join("\n");
}

const ADAPTATION_RULES = `Como adaptar a aula a este aluno:
- Reserve cerca de um terço dos exercícios para os pontos fracos de prioridade alta e média, dentro do tema da aula. Siga a orientação do diagnóstico.
- Ritmo "consolidar": mais exercícios guiados antes da produção livre, distratores claros e o limite inferior de palavras novas. Ritmo "acelerar": mais produção livre, distratores sutis e estruturas um pouco acima do nível. Ritmo "manter": siga o objetivo da aula.
- Com mais de 25 palavras pendentes de revisão, apresente no máximo metade das palavras novas previstas e use mais exercícios com palavras de revisão.
- Use os interesses do aluno nos textos e nos exemplos quando couberem no tema. Leve em conta o recado dele.
- Se a prova estiver a menos de 60 dias, use formatos e tarefas do DELE sempre que possível.`;

const EXERCISE_RULES = `Regras dos exercícios:
- instruction em português. focus nomeia o alvo exato (por exemplo "presente de subjuntivo", "sin embargo", "estar + adjetivo", "apellido"). Para grupos de conjugação escreva "verbos em -ar/-er/-ir", nunca só "-ir", que se confunde com o verbo ir. focus só aparece depois da resposta; instruction e hint nunca podem entregar a resposta. lemmas lista as palavras do vocabulário (novo, de revisão ou difícil) que o exercício treina, copiando exatamente o campo lemma delas.
- explanation: em português, por que a resposta certa é a certa, apontando a armadilha do português quando houver.
- choice: prompt em espanhol; de 3 a 4 opções; uma única correta, cujo índice (começando em 0) vai em answer. Os distratores devem ser plausíveis, de preferência os erros típicos de brasileiros e os erros reais deste aluno.
- fill: prompt em espanhol com a lacuna escrita exatamente uma vez como ${BLANK}. Em conjugação, hint sempre traz o infinitivo, e também o tempo e a pessoa quando o contexto não bastar (por exemplo "tener · pretérito indefinido"). answers lista todas as respostas corretas para a lacuna, incluindo variantes válidas (hubiera/hubiese). A lacuna deve ter uma resposta inequívoca.
- translate: source em português, com uma ou duas frases que obriguem a usar o ponto trabalhado; reference é uma tradução natural.
- write: task em português descreve a situação e o que escrever; requirements lista o que é obrigatório usar (conectores, tempos, palavras); minWords e maxWords limitam o tamanho; reference é uma resposta modelo do nível.`;

const VOCABULARY_RULES = "vocabulary: só as palavras novas. lemma é a forma de dicionário sem artigo; display traz o artigo nos substantivos (el puente, la leche); partOfSpeech em português; note explica o contraste com o português quando houver (falso amigo, gênero diferente, sílaba tônica diferente) e fica vazio quando não houver; contrast classifica a palavra.";

export function lessonPrompt(plan: CoursePlan, unitNumber: number, step: number, learner: LearnerSnapshot): string {
  const unit = plan.units[unitNumber - 1];
  const role = LESSON_ROLES[step - 1];
  return `Crie a aula ${step} de ${LESSONS_PER_UNIT} ("${role.name}") desta unidade:
${unitBrief(plan, unitNumber)}

Objetivo desta aula: ${role.brief(unit)}

${learnerBrief(learner)}

${ADAPTATION_RULES}

Como montar a aula:
- title em espanhol; goal em português, dizendo em uma frase o que o aluno vai conseguir fazer.
- explanation: o ponto central da aula, em português, com tabelas de conjugação em Markdown quando houver verbos, a comparação com o português e de 3 a 6 exemplos em espanhol com tradução.
- ${VOCABULARY_RULES}
- reading: null, salvo quando o objetivo pedir texto.
- exercises: misture as habilidades. Em toda aula entram conjugação, conectores e vocabulário (palavras novas e de revisão). Inclua contrastes com o português sempre que a unidade tratar deles.

${EXERCISE_RULES}`;
}

export function reinforcementPrompt(plan: CoursePlan, unitNumber: number, learner: LearnerSnapshot): string {
  return `Crie uma aula de reforço sob medida para este aluno, sem conteúdo novo. Ele está nesta unidade:
${unitBrief(plan, unitNumber)}

Objetivo: trabalhar os pontos fracos do diagnóstico (ou, sem diagnóstico, os pontos com acerto baixo e os erros recentes) e as palavras pendentes e difíceis, até o aluno acertar com segurança.

${learnerBrief(learner)}

Como montar a aula:
- title em espanhol; goal em português, dizendo o que será reforçado.
- explanation: revisão direta dos 2 ou 3 pontos fracos mais prioritários: a regra, a comparação com o português e os erros reais do aluno já corrigidos. Use tabelas em Markdown quando ajudar e de 3 a 6 exemplos em espanhol com tradução.
- vocabulary: lista vazia. O reforço não apresenta palavras novas.
- reading: null, ou um texto curto (até 150 palavras) quando ajudar a fixar os pontos em contexto.
- exercises: de 12 a 16, do mais guiado ao mais livre, todos ligados aos pontos fracos e às palavras pendentes e difíceis. Termine com uma produção escrita curta que exija os pontos trabalhados.

${EXERCISE_RULES}`;
}
